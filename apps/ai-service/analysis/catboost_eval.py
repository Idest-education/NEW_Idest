"""Train CatBoost per criterion and compare it against the LLM baseline.

ADR 003 decides the LLM grader is the initial baseline and that a CatBoost
model is trained on teacher-graded data afterwards and compared against it.
This module produces that comparison on a single held-out set, so the two
numbers in the thesis are measured on exactly the same essays.

THE SPLIT IS BY ASSIGNMENT, NEVER BY ROW. A student may submit several
attempts of the same essay on the same prompt. A random row split puts attempt
1 in training and attempt 2 in test, the model sees nearly the same text twice,
and the reported error falls for a reason that is not learning. Holding out
whole assignments removes that path entirely.

The feature set deliberately includes the AI criterion scores. The question
ADR 003 asks is not "can a model grade an essay from scratch" but "can a model
learn where the LLM is wrong and correct it", so the LLM's own output is an
input. `essay_text` is used as a CatBoost text feature when the export was
taken with include_essays=true, and omitted otherwise.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor, Pool

from .agreement import CLASS_LABELS, band_to_classes
from .load import CRITERIA, SCORE_FIELDS, with_ai_baseline

DEFAULT_SEED = 20260921

NUMERIC_FEATURES: tuple[str, ...] = ("word_count",) + tuple(
    f"ai_{field}" for field in SCORE_FIELDS
)
CATEGORICAL_FEATURES: tuple[str, ...] = ("task_type",)
TEXT_FEATURES: tuple[str, ...] = ("essay_text",)


class InsufficientAssignmentsError(ValueError):
    """Fewer than two assignments, so no assignment-level split is possible."""


@dataclass(frozen=True)
class Split:
    train: pd.DataFrame
    test: pd.DataFrame
    train_assignments: tuple[str, ...]
    test_assignments: tuple[str, ...]


def split_by_assignment(
    frame: pd.DataFrame,
    *,
    test_size: float = 0.25,
    seed: int = DEFAULT_SEED,
) -> Split:
    """Hold out whole assignments, never individual rows.

    Every attempt on a held-out assignment goes to the test side together, so
    no near-duplicate essay can appear on both sides of the boundary.
    """
    comparable = with_ai_baseline(frame)
    assignments = np.sort(comparable["assignment_id"].astype(str).unique())
    if len(assignments) < 2:
        raise InsufficientAssignmentsError(
            f"an assignment-level split needs at least 2 assignments, got "
            f"{len(assignments)}. Splitting by row instead would leak repeat "
            "attempts of the same essay across the train/test boundary."
        )

    rng = np.random.default_rng(seed)
    shuffled = rng.permutation(assignments)
    n_test = max(1, min(len(assignments) - 1, round(len(assignments) * test_size)))
    test_assignments = tuple(sorted(str(a) for a in shuffled[:n_test]))
    train_assignments = tuple(sorted(str(a) for a in shuffled[n_test:]))

    key = comparable["assignment_id"].astype(str)
    return Split(
        train=comparable[key.isin(train_assignments)].reset_index(drop=True),
        test=comparable[key.isin(test_assignments)].reset_index(drop=True),
        train_assignments=train_assignments,
        test_assignments=test_assignments,
    )


def feature_columns(frame: pd.DataFrame) -> tuple[list[str], list[str], list[str]]:
    """Numeric, categorical, and text feature names present in this frame.

    Identifiers and every `teacher_*` column are excluded: the identifiers
    carry no signal and would let the model memorise a student, and the
    teacher columns are the target.
    """
    numeric = [column for column in NUMERIC_FEATURES if column in frame.columns]
    categorical = [column for column in CATEGORICAL_FEATURES if column in frame.columns]
    text = [
        column
        for column in TEXT_FEATURES
        if column in frame.columns and frame[column].notna().any()
    ]
    return numeric, categorical, text


def _build_pool(
    frame: pd.DataFrame,
    criterion: str,
    numeric: list[str],
    categorical: list[str],
    text: list[str],
) -> Pool:
    features = frame[numeric + categorical + text].copy()
    for column in categorical:
        features[column] = features[column].fillna("unknown").astype(str)
    for column in text:
        features[column] = features[column].fillna("").astype(str)
    return Pool(
        data=features,
        label=frame[f"teacher_{criterion}"].astype(float),
        cat_features=categorical or None,
        text_features=text or None,
    )


def _kappa(predicted: pd.Series, actual: pd.Series) -> float | None:
    from sklearn.metrics import cohen_kappa_score

    # Predictions are continuous. Snap them to the nearest half band before
    # scoring, which is the scale a teacher actually writes on.
    snapped = (predicted.astype(float) * 2).round().clip(0, 18) / 2
    value = cohen_kappa_score(
        band_to_classes(snapped).tolist(),
        band_to_classes(actual.astype(float)).tolist(),
        weights="quadratic",
        labels=CLASS_LABELS,
    )
    return None if pd.isna(value) else float(value)


@dataclass(frozen=True)
class CriterionComparison:
    criterion: str
    n_train: int
    n_test: int
    n_train_assignments: int
    n_test_assignments: int
    llm_mae: float
    catboost_mae: float
    llm_kappa: float | None
    catboost_kappa: float | None
    mae_improvement: float

    def as_row(self) -> dict[str, object]:
        return asdict(self)


def evaluate_criterion(
    split: Split,
    criterion: str,
    *,
    iterations: int = 400,
    seed: int = DEFAULT_SEED,
) -> CriterionComparison:
    """Train on the training assignments and score both models on the holdout."""
    if criterion not in SCORE_FIELDS:
        raise ValueError(f"{criterion!r} is not one of {SCORE_FIELDS}")

    numeric, categorical, text = feature_columns(split.train)
    train_pool = _build_pool(split.train, criterion, numeric, categorical, text)
    test_pool = _build_pool(split.test, criterion, numeric, categorical, text)

    model = CatBoostRegressor(
        iterations=iterations,
        depth=6,
        learning_rate=0.05,
        loss_function="RMSE",
        random_seed=seed,
        verbose=False,
        allow_writing_files=False,
    )
    model.fit(train_pool)

    actual = split.test[f"teacher_{criterion}"].astype(float)
    llm = split.test[f"ai_{criterion}"].astype(float)
    predicted = pd.Series(model.predict(test_pool), index=actual.index)

    llm_mae = float((llm - actual).abs().mean())
    catboost_mae = float((predicted - actual).abs().mean())

    return CriterionComparison(
        criterion=criterion,
        n_train=int(len(split.train)),
        n_test=int(len(split.test)),
        n_train_assignments=len(split.train_assignments),
        n_test_assignments=len(split.test_assignments),
        llm_mae=llm_mae,
        catboost_mae=catboost_mae,
        llm_kappa=_kappa(llm, actual),
        catboost_kappa=_kappa(predicted, actual),
        mae_improvement=llm_mae - catboost_mae,
    )


def evaluate_all(
    frame: pd.DataFrame,
    *,
    test_size: float = 0.25,
    iterations: int = 400,
    seed: int = DEFAULT_SEED,
) -> list[CriterionComparison]:
    """Compare CatBoost against the LLM on one shared held-out set.

    The split is computed once, so every criterion is measured on exactly the
    same essays and the rows of the thesis table are comparable.
    """
    split = split_by_assignment(frame, test_size=test_size, seed=seed)
    return [
        evaluate_criterion(split, criterion, iterations=iterations, seed=seed)
        for criterion in CRITERIA + ("overall",)
    ]
