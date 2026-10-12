"""The reply a grader returns becomes scores and feedback only when it is a valid assessment."""

import pytest
from pydantic import ValidationError
from schemas import overall_band, to_result

ESSAY = "Some people think cars are bad. In my opinion they is useful."


def reply(bands=(6.5, 6.0, 6.5, 6.0), sentences=()):
    keys = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")
    return {
        **{k: {"evidence": ["they is useful"], "reasoning": "why", "band": b, "comment": "c"} for k, b in zip(keys, bands)},
        "sentence_feedback": list(sentences),
        "comment": "overall",
    }


def sentence(original):
    return {"original": original, "explanation": "Subject-verb agreement.", "suggestion": "they are useful",
            "category": "grammatical_range_accuracy"}


@pytest.mark.parametrize("bands, expected", [
    ((6.5, 6.0, 6.5, 6.0), 6.5),   # mean 6.25 rounds up to 6.5
    ((7.0, 7.0, 6.5, 6.5), 7.0),   # mean 6.75 rounds up to 7.0
    ((6.0, 6.0, 6.0, 6.5), 6.0),   # mean 6.125 rounds down
    ((5.0, 5.5, 5.5, 5.5), 5.5),   # mean 5.375 rounds up to 5.5
])
def test_overall_follows_the_ielts_rounding_rule(bands, expected):
    assert overall_band(list(bands)) == expected
    scores, _ = to_result(reply(bands), ESSAY)
    assert scores["overall"] == expected


def test_a_band_off_the_half_step_is_rejected():
    with pytest.raises(ValidationError):
        to_result(reply((6.3, 6.0, 6.5, 6.0)), ESSAY)


def test_a_missing_criterion_is_rejected():
    bad = reply()
    del bad["lexical_resource"]
    with pytest.raises(ValidationError):
        to_result(bad, ESSAY)


def test_a_sentence_comment_quoting_text_not_in_the_essay_is_dropped():
    _, feedback = to_result(reply(sentences=[sentence("they is useful"), sentence("cars was invented")]), ESSAY)
    assert [s["original"] for s in feedback["sentence_feedback"]] == ["they is useful"]


def test_feedback_carries_the_overall_and_per_criterion_comments():
    _, feedback = to_result(reply(), ESSAY)
    assert feedback["comment"] == "overall"
    assert feedback["criteria"]["task_response"] == {"comment": "c", "evidence": ["they is useful"], "reasoning": "why"}
