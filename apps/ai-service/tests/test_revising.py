"""The second reading: only extreme drafts go back to the same grader."""

import pytest
from prompt import IELTS_SYSTEM_PROMPT, REVISE_SYSTEM_PROMPT, prompts_for
from providers.revising import RevisingScorer, needs_revision


class FakeGrader:
    def __init__(self, overalls, error=None):
        self.overalls = list(overalls)
        self.error = error
        self.calls = []

    async def score_essay(self, task_prompt, task_type, essay_text, task_image_url=None, review_of=None):
        self.calls.append(review_of)
        if review_of is not None and self.error:
            raise self.error
        overall = self.overalls.pop(0)
        return {
            "status": "completed",
            "scores": {"overall": overall},
            "feedback": {},
            "raw_output": {"pass": len(self.calls)},
            "processing_metadata": {"elapsed_ms": 100, "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }

    def descriptor(self):
        return {"provider": "fake"}


@pytest.mark.parametrize("overall, expected", [(4.5, True), (5.0, False), (6.5, False), (7.5, False), (8.0, True)])
def test_only_bands_outside_the_middle_are_revised(overall, expected):
    assert needs_revision(overall) is expected


async def test_a_middle_draft_is_returned_after_one_call():
    grader = FakeGrader([6.5])
    result = await RevisingScorer(grader).score_essay("p", "task_2", "essay")

    assert grader.calls == [None]
    assert result["processing_metadata"]["revised"] is False


async def test_an_extreme_draft_is_moderated_by_the_same_grader():
    grader = FakeGrader([8.5, 8.0])
    result = await RevisingScorer(grader).score_essay("p", "task_2", "essay")

    assert grader.calls == [None, {"pass": 1}]
    assert result["scores"] == {"overall": 8.0}
    assert result["raw_output"] == {"draft": {"pass": 1}, "revised": {"pass": 2}}
    meta = result["processing_metadata"]
    assert meta["revised"] is True
    assert meta["draft_scores"] == {"overall": 8.5}
    assert (meta["elapsed_ms"], meta["total_tokens"]) == (200, 30)


async def test_a_failed_revision_fails_the_grading():
    grader = FakeGrader([4.0], error=RuntimeError("503"))
    with pytest.raises(RuntimeError):
        await RevisingScorer(grader).score_essay("p", "task_2", "essay")


def draft(band):
    keys = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")
    return {
        **{k: {"evidence": ["q"], "reasoning": f"fits band {band}", "band": band, "comment": "c"} for k in keys},
        "sentence_feedback": [],
        "comment": "overall",
    }


def test_the_second_reading_gets_the_quotes_but_never_the_bands():
    system, user = prompts_for("p", "task_2", "essay", review_of=draft(8.0))

    assert system.startswith(IELTS_SYSTEM_PROMPT) and "at the top of the scale" in system
    first = user.split("<<<FIRST_READING>>>\n")[1].split("\n<<<END_FIRST_READING>>>")[0]
    assert '"evidence": ["q"]' in first and '"comment": "overall"' in first
    assert "band" not in first and "fits" not in first
    assert prompts_for("p", "task_2", "essay")[0] == IELTS_SYSTEM_PROMPT


def test_a_low_draft_is_checked_from_the_bottom():
    system, _ = prompts_for("p", "task_2", "essay", review_of=draft(4.0))
    assert "at the bottom of the scale" in system
    assert REVISE_SYSTEM_PROMPT.replace("{position}", "bottom") == system
