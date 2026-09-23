"""Agreement between the LLM baseline and the teacher's final score.

Quadratic weighted kappa, exact agreement, agreement within half a band, mean
absolute error, and Spearman rank correlation, per criterion and overall.

Two rules are enforced here rather than left to the caller, because getting
either of them wrong produces a plausible number instead of an error:

1. Only rows with `has_ai_baseline` are compared. A teacher-first revision has
   no AI score to compare against (spec section 6.1).
2. `cohen_kappa_score` always receives the full half-band class space as
   `labels`. It builds its weight matrix from label POSITIONS, so inferring
   labels from data with a gap in it silently shrinks the distance across that
   gap.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import pandas as pd
from sklearn.metrics import cohen_kappa_score

from .load import (
    PRE_PROVENANCE,
    SCORE_FIELDS,
    with_ai_baseline,
    with_model_provenance,
)

#: IELTS bands run 0.0 to 9.0 in half-band steps. Doubling maps them onto the
#: integer classes 0..18. Index i in this list equals class value i, so the
#: quadratic weight (i - j)**2 is the squared band distance, doubled.
CLASS_LABELS: list[int] = list(range(0, 19))

BAND_MIN = 0.0
BAND_MAX = 9.0
HALF_BAND = 0.5


def band_to_classes(values: pd.Series) -> pd.Series:
    """Map IELTS half-band scores onto the integer classes 0..18."""
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.isna().any():
        raise ValueError("band_to_classes received a missing or non-numeric band")
    if ((numeric < BAND_MIN) | (numeric > BAND_MAX)).any():
        raise ValueError(
            f"band value outside the IELTS band scale [{BAND_MIN}, {BAND_MAX}]"
        )
    return (numeric * 2).round().astype(int)


@dataclass(frozen=True)
class AgreementResult:
    """Agreement on one score field. Every metric is None when n is 0.

    None is used rather than 0.0 on purpose: a kappa of 0.0 reads as "the LLM
    and the teacher agreed no better than chance", which is a claim. No
    comparable rows is the absence of a claim.
    """

    field: str
    n: int
    n_excluded_no_baseline: int
    quadratic_kappa: float | None
    exact_agreement: float | None
    within_half_band: float | None
    mean_absolute_error: float | None
    spearman_rho: float | None
    #: Spec section 9. When base_result_id is not null the teacher saw the AI
    #: score before entering their own, so this is agreement under anchoring,
    #: not independent agreement.
    anchored: bool = True

    def as_row(self) -> dict[str, object]:
        return asdict(self)


def _empty(field: str, n_excluded: int) -> AgreementResult:
    return AgreementResult(
        field=field,
        n=0,
        n_excluded_no_baseline=n_excluded,
        quadratic_kappa=None,
        exact_agreement=None,
        within_half_band=None,
        mean_absolute_error=None,
        spearman_rho=None,
    )


def _spearman(left: pd.Series, right: pd.Series) -> float | None:
    """Spearman rho as the Pearson correlation of average ranks.

    Computed with pandas alone so this package does not depend on SciPy being
    pulled in transitively by scikit-learn.
    """
    left_ranks = left.rank()
    right_ranks = right.rank()
    if left_ranks.nunique() < 2 or right_ranks.nunique() < 2:
        return None
    value = left_ranks.corr(right_ranks)
    return None if pd.isna(value) else float(value)


def agreement_for(frame: pd.DataFrame, field: str) -> AgreementResult:
    """Compute every agreement metric for one score field."""
    if field not in SCORE_FIELDS:
        raise ValueError(f"{field!r} is not one of {SCORE_FIELDS}")

    comparable = with_ai_baseline(frame)
    n_excluded = int(len(frame) - len(comparable))

    ai_column = f"ai_{field}"
    teacher_column = f"teacher_{field}"
    comparable = comparable.dropna(subset=[ai_column, teacher_column])
    if comparable.empty:
        return _empty(field, n_excluded)

    ai_bands = comparable[ai_column].astype(float)
    teacher_bands = comparable[teacher_column].astype(float)
    ai_classes = band_to_classes(ai_bands)
    teacher_classes = band_to_classes(teacher_bands)

    kappa = cohen_kappa_score(
        ai_classes.tolist(),
        teacher_classes.tolist(),
        weights="quadratic",
        labels=CLASS_LABELS,
    )

    difference = (ai_bands - teacher_bands).abs()

    return AgreementResult(
        field=field,
        n=int(len(comparable)),
        n_excluded_no_baseline=n_excluded,
        # A degenerate table — every score identical on both sides — gives a
        # zero expected disagreement and kappa comes back as NaN. That is not
        # a measurement either.
        quadratic_kappa=None if pd.isna(kappa) else float(kappa),
        exact_agreement=float((difference == 0).mean()),
        within_half_band=float((difference <= HALF_BAND).mean()),
        mean_absolute_error=float(difference.mean()),
        spearman_rho=_spearman(ai_bands, teacher_bands),
    )


def agreement_table(frame: pd.DataFrame) -> list[AgreementResult]:
    """Agreement for each of the four criteria and for the overall band."""
    return [agreement_for(frame, field) for field in SCORE_FIELDS]


def agreement_by_reason_source(frame: pd.DataFrame) -> dict[str, list[AgreementResult]]:
    """Agreement split by how the override reason was captured.

    Spec section 9: batch-tagged reasons are given after the fact and are
    weaker evidence than reasons given at the moment of the decision, so the
    analysis must be able to separate them. Untagged revisions never form a
    bucket — an absent reason is not a reason.
    """
    tagged = frame[frame["is_tagged"]]
    return {
        str(source): agreement_table(group.reset_index(drop=True))
        for source, group in tagged.groupby("reason_source", dropna=True)
    }


def agreement_by_model(frame: pd.DataFrame) -> dict[str, list[AgreementResult]]:
    """Agreement split by AI model version.

    Spec section 9: results written before the provenance fix carry no model
    version and cannot be attributed retroactively, so they are excluded here.
    The count of excluded rows is available from `load.caveat_summary`.
    """
    attributable = with_model_provenance(frame)
    return {
        str(model): agreement_table(group.reset_index(drop=True))
        for model, group in attributable.groupby("model_name", dropna=True)
        if str(model) != PRE_PROVENANCE
    }
