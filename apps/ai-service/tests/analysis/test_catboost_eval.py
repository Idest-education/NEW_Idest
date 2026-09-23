from pathlib import Path

import pandas as pd
import pytest

from analysis.catboost_eval import (
    DEFAULT_SEED,
    CriterionComparison,
    InsufficientAssignmentsError,
    Split,
    evaluate_all,
    evaluate_criterion,
    feature_columns,
    split_by_assignment,
)
from analysis.load import load_outcomes_csv

FIXTURE = Path(__file__).parent / "fixtures" / "outcomes_small.csv"


def _synthetic(n_assignments: int = 12, attempts: int = 3) -> pd.DataFrame:
    """Several assignments, each with repeat attempts by the same student.

    Repeat attempts are exactly the situation an assignment-level split has to
    protect against: near-duplicate essays that must not straddle the boundary.
    """
    rows = []
    for a in range(n_assignments):
        for k in range(attempts):
            ai_band = 5.0 + (a % 7) * 0.5
            rows.append(
                {
                    "submission_id": f"s-{a:03d}-{k}",
                    "assignment_id": f"a-{a:03d}",
                    "student_id": f"stu-{a:03d}",
                    "teacher_id": "tea-0001",
                    "task_type": "task_2" if a % 2 == 0 else "task_1",
                    "word_count": 250 + a * 7 + k,
                    "ai_task_response": ai_band,
                    "ai_coherence_cohesion": ai_band,
                    "ai_lexical_resource": ai_band,
                    "ai_grammatical_range_accuracy": ai_band,
                    "ai_overall": ai_band,
                    "teacher_task_response": min(9.0, ai_band + 0.5),
                    "teacher_coherence_cohesion": min(9.0, ai_band + 0.5),
                    "teacher_lexical_resource": ai_band,
                    "teacher_grammatical_range_accuracy": min(9.0, ai_band + 0.5),
                    "teacher_overall": min(9.0, ai_band + 0.5),
                    "has_ai_baseline": True,
                    "is_tagged": False,
                    "reason_codes": None,
                    "reason_source": None,
                    "model_name": "gemini-3.6-flash",
                    "is_published": True,
                }
            )
    return pd.DataFrame(rows)


def test_split_puts_no_assignment_on_both_sides():
    """This is the whole point of the task. A student may submit several
    attempts of the same essay on the same prompt, so a random ROW split leaks
    near-duplicate text across the boundary and inflates the result."""
    split = split_by_assignment(_synthetic())

    train_assignments = set(split.train["assignment_id"])
    test_assignments = set(split.test["assignment_id"])

    assert train_assignments & test_assignments == set()
    assert set(split.train_assignments) == train_assignments
    assert set(split.test_assignments) == test_assignments


def test_split_keeps_every_attempt_of_an_assignment_together():
    frame = _synthetic()
    split = split_by_assignment(frame)

    for assignment, group in frame.groupby("assignment_id"):
        in_train = split.train["submission_id"].isin(group["submission_id"]).sum()
        in_test = split.test["submission_id"].isin(group["submission_id"]).sum()
        assert in_train == 0 or in_test == 0, (
            f"assignment {assignment} was split across the train/test boundary"
        )
        assert in_train + in_test == len(group)


def test_split_loses_no_row():
    frame = _synthetic()
    split = split_by_assignment(frame)
    assert len(split.train) + len(split.test) == len(frame)


def test_split_is_deterministic_for_a_seed():
    frame = _synthetic()
    first = split_by_assignment(frame, seed=DEFAULT_SEED)
    second = split_by_assignment(frame, seed=DEFAULT_SEED)
    assert first.test_assignments == second.test_assignments


def test_a_different_seed_selects_a_different_holdout():
    frame = _synthetic(n_assignments=20)
    assert (
        split_by_assignment(frame, seed=1).test_assignments
        != split_by_assignment(frame, seed=2).test_assignments
    )


def test_split_holds_out_roughly_the_requested_share_of_assignments():
    frame = _synthetic(n_assignments=20)
    split = split_by_assignment(frame, test_size=0.25)
    assert len(split.test_assignments) == 5
    assert len(split.train_assignments) == 15


def test_split_returns_a_split_dataclass():
    assert isinstance(split_by_assignment(_synthetic()), Split)


def test_split_refuses_a_dataset_with_one_assignment():
    frame = _synthetic(n_assignments=1)
    with pytest.raises(InsufficientAssignmentsError, match="assignment"):
        split_by_assignment(frame)


def test_split_excludes_rows_without_an_ai_baseline():
    frame = load_outcomes_csv(FIXTURE)
    split = split_by_assignment(frame, test_size=0.5)
    kept = set(split.train["submission_id"]) | set(split.test["submission_id"])
    assert "s-0005" not in kept


def test_feature_columns_omit_the_target_and_the_identifiers():
    numeric, categorical, text = feature_columns(_synthetic())
    assert "word_count" in numeric
    assert "ai_overall" in numeric
    assert "task_type" in categorical
    assert text == []
    for leak in ("teacher_overall", "submission_id", "assignment_id", "student_id"):
        assert leak not in numeric + categorical + text


def test_feature_columns_use_essay_text_when_the_export_included_it():
    frame = _synthetic()
    frame["essay_text"] = "some essay body"
    _, _, text = feature_columns(frame)
    assert text == ["essay_text"]


def test_evaluate_criterion_compares_catboost_against_the_llm_baseline():
    split = split_by_assignment(_synthetic(n_assignments=16))
    comparison = evaluate_criterion(split, "overall", iterations=60)

    assert isinstance(comparison, CriterionComparison)
    assert comparison.criterion == "overall"
    assert comparison.n_train > 0
    assert comparison.n_test > 0
    assert comparison.n_train_assignments + comparison.n_test_assignments == 16
    assert comparison.llm_mae == pytest.approx(0.5)
    assert comparison.catboost_mae >= 0.0
    assert comparison.mae_improvement == pytest.approx(
        comparison.llm_mae - comparison.catboost_mae
    )


def test_evaluate_all_covers_four_criteria_plus_overall():
    comparisons = evaluate_all(_synthetic(n_assignments=16), iterations=60)
    assert [c.criterion for c in comparisons] == [
        "task_response",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range_accuracy",
        "overall",
    ]


def test_comparison_as_row_is_flat():
    split = split_by_assignment(_synthetic(n_assignments=16))
    row = evaluate_criterion(split, "overall", iterations=60).as_row()
    assert row["criterion"] == "overall"
    assert "llm_mae" in row and "catboost_mae" in row
