import json

import pandas as pd
import pytest

from analysis.feedback_divergence import (
    FeedbackDivergence,
    MissingFeedbackColumnsError,
    divergence_for_row,
    divergence_summary,
    divergence_table,
    jaccard,
    normalized_levenshtein,
    parse_items,
    set_overlap,
    tokenize,
)


def test_tokenize_lowercases_and_drops_punctuation():
    assert tokenize("The essay, overall, is Clear!") == (
        "the",
        "essay",
        "overall",
        "is",
        "clear",
    )


def test_tokenize_of_nothing_is_empty():
    assert tokenize("") == ()
    assert tokenize(None) == ()
    assert tokenize(float("nan")) == ()


def test_jaccard_is_intersection_over_union():
    # tokens {a, b, c} and {b, c, d}: intersection 2, union 4
    assert jaccard("a b c", "b c d") == pytest.approx(0.5)


def test_jaccard_of_identical_text_is_one():
    assert jaccard("clear position, good structure", "clear position good structure") == 1.0


def test_jaccard_is_none_when_either_side_is_empty():
    assert jaccard("", "b c d") is None
    assert jaccard("a b c", None) is None


def test_normalized_levenshtein_is_distance_over_the_longer_string():
    # "kitten" -> "sitting" is 3 edits over a longest length of 7
    assert normalized_levenshtein("kitten", "sitting") == pytest.approx(3 / 7)


def test_normalized_levenshtein_of_identical_text_is_zero():
    assert normalized_levenshtein("same text", "same text") == 0.0


def test_normalized_levenshtein_is_none_when_both_sides_are_empty():
    assert normalized_levenshtein("", "") is None


def test_parse_items_reads_json_arrays_and_postgres_arrays():
    assert parse_items('["one", "two"]') == ("one", "two")
    assert parse_items("{one,two}") == ("one", "two")
    assert parse_items(["one", "two"]) == ("one", "two")
    assert parse_items("") is None
    assert parse_items(None) is None


def test_set_overlap_is_jaccard_over_normalised_items():
    left = json.dumps(["Clear position presented", "Logical organization"])
    right = json.dumps(["clear position presented", "Varied vocabulary"])
    # one shared item, three distinct items overall
    assert set_overlap(left, right) == pytest.approx(1 / 3)


def test_set_overlap_is_none_when_either_list_is_absent():
    assert set_overlap(None, json.dumps(["a"])) is None
    assert set_overlap(json.dumps([]), json.dumps(["a"])) is None


def test_divergence_for_row_fills_every_measure():
    row = pd.Series(
        {
            "submission_id": "s-0001",
            "ai_summary": "a b c",
            "teacher_summary": "b c d",
            "ai_strengths": json.dumps(["one", "two"]),
            "teacher_strengths": json.dumps(["one"]),
            "ai_improvements": json.dumps(["three"]),
            "teacher_improvements": json.dumps(["three"]),
        }
    )
    result = divergence_for_row(row)
    assert isinstance(result, FeedbackDivergence)
    assert result.submission_id == "s-0001"
    assert result.summary_jaccard == pytest.approx(0.5)
    assert result.strengths_overlap == pytest.approx(0.5)
    assert result.improvements_overlap == pytest.approx(1.0)
    assert result.summary_levenshtein is not None


def test_divergence_table_keeps_a_row_with_no_teacher_feedback():
    frame = pd.DataFrame(
        [
            {
                "submission_id": "s-0001",
                "ai_summary": "a b c",
                "teacher_summary": "b c d",
                "ai_strengths": json.dumps(["one"]),
                "teacher_strengths": json.dumps(["one"]),
                "ai_improvements": json.dumps(["two"]),
                "teacher_improvements": json.dumps(["two"]),
            },
            {
                "submission_id": "s-0002",
                "ai_summary": "a b c",
                "teacher_summary": "",
                "ai_strengths": json.dumps(["one"]),
                "teacher_strengths": None,
                "ai_improvements": json.dumps(["two"]),
                "teacher_improvements": None,
            },
        ]
    )
    table = divergence_table(frame)
    assert list(table["submission_id"]) == ["s-0001", "s-0002"]
    assert pd.isna(table.loc[1, "summary_jaccard"])
    assert table.loc[0, "summary_jaccard"] == pytest.approx(0.5)


def test_divergence_table_reports_missing_columns_by_name():
    frame = pd.DataFrame([{"submission_id": "s-0001", "ai_summary": "a"}])
    with pytest.raises(MissingFeedbackColumnsError) as excinfo:
        divergence_table(frame)
    message = str(excinfo.value)
    assert "teacher_summary" in message
    assert "load_feedback_pairs_db" in message


def test_divergence_summary_ignores_rows_with_nothing_to_compare():
    table = pd.DataFrame(
        {
            "submission_id": ["s-0001", "s-0002"],
            "summary_jaccard": [0.5, None],
            "summary_levenshtein": [0.4, None],
            "strengths_overlap": [1.0, None],
            "improvements_overlap": [0.0, None],
        }
    )
    summary = divergence_summary(table)
    assert summary["rows"] == 2
    assert summary["compared"] == 1
    assert summary["mean_summary_jaccard"] == pytest.approx(0.5)
    assert summary["mean_improvements_overlap"] == pytest.approx(0.0)
