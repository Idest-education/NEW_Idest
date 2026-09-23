from pathlib import Path

import pandas as pd
import pytest

from analysis.load import (
    CRITERIA,
    PRE_PROVENANCE,
    REQUIRED_COLUMNS,
    SCORE_FIELDS,
    MissingColumnsError,
    caveat_summary,
    load_outcomes_csv,
    tagged_only,
    with_ai_baseline,
    with_model_provenance,
)

FIXTURE = Path(__file__).parent / "fixtures" / "outcomes_small.csv"


def test_criteria_are_the_four_ielts_bands():
    assert CRITERIA == (
        "task_response",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range_accuracy",
    )
    assert SCORE_FIELDS == CRITERIA + ("overall",)


def test_loads_every_exported_row():
    frame = load_outcomes_csv(FIXTURE)
    assert len(frame) == 5
    assert REQUIRED_COLUMNS.issubset(frame.columns)


def test_scores_are_numeric_and_missing_ai_scores_stay_missing():
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame.loc["s-0001", "ai_overall"] == pytest.approx(6.5)
    assert frame.loc["s-0004", "teacher_overall"] == pytest.approx(8.5)
    assert pd.isna(frame.loc["s-0005", "ai_overall"])


def test_has_ai_baseline_is_a_real_boolean_not_a_string():
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame["has_ai_baseline"].dtype == bool
    assert frame.loc["s-0001", "has_ai_baseline"] is True or frame.loc["s-0001", "has_ai_baseline"]
    assert not frame.loc["s-0005", "has_ai_baseline"]


def test_with_ai_baseline_drops_the_teacher_first_row():
    frame = with_ai_baseline(load_outcomes_csv(FIXTURE))
    assert list(frame["submission_id"]) == ["s-0001", "s-0002", "s-0003", "s-0004"]


def test_reason_codes_parse_to_tuples_and_untagged_stays_none():
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame.loc["s-0001", "reason_codes"] == ("ai_too_generous",)
    assert frame.loc["s-0004", "reason_codes"] == ("ai_too_harsh", "ai_wrong_criterion")
    assert frame.loc["s-0002", "reason_codes"] is None
    assert frame.loc["s-0002", "is_tagged"] is False or not frame.loc["s-0002", "is_tagged"]


def test_untagged_is_never_an_empty_reason_set():
    """Spec section 9: an empty tag set means the reason was not captured, not
    that there was no reason. The two must never be conflated."""
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame.loc["s-0002", "reason_codes"] is not ()
    assert frame.loc["s-0002", "reason_codes"] is None


def test_tagged_only_keeps_inline_and_batch_and_drops_untagged():
    frame = tagged_only(load_outcomes_csv(FIXTURE))
    assert list(frame["submission_id"]) == ["s-0001", "s-0003", "s-0004"]
    assert set(frame["reason_source"]) == {"batch", "inline"}


def test_with_model_provenance_drops_pre_provenance_rows():
    frame = with_model_provenance(load_outcomes_csv(FIXTURE))
    assert list(frame["submission_id"]) == ["s-0001", "s-0002", "s-0003"]
    assert PRE_PROVENANCE not in set(frame["model_name"])


def test_caveat_summary_counts_every_section_nine_caveat():
    summary = caveat_summary(load_outcomes_csv(FIXTURE))
    assert summary == {
        "rows": 5,
        "with_ai_baseline": 4,
        "without_ai_baseline": 1,
        "anchored": 4,
        "tagged": 3,
        "untagged": 2,
        "tagged_inline": 1,
        "tagged_batch": 2,
        "pre_provenance": 1,
        "published": 4,
    }


def test_missing_columns_fail_loudly(tmp_path):
    truncated = tmp_path / "truncated.csv"
    truncated.write_text("submission_id,ai_overall\ns-0001,6.5\n", encoding="utf-8")
    with pytest.raises(MissingColumnsError) as excinfo:
        load_outcomes_csv(truncated)
    assert "teacher_overall" in str(excinfo.value)
    assert "has_ai_baseline" in str(excinfo.value)
