"""Rotation behaviour: spread the quota, skip what is limited, keep provenance."""

import json

import pytest
from cache import CachedScorer, ScoringCache
from providers.rotating import RotatingScorer

COOLDOWN = 300.0


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class RateLimited(Exception):
    def __init__(self, retry_after=None):
        super().__init__("429 rate limited")
        self.code = 429
        self.details = {"retryDelay": f"{retry_after}s"} if retry_after else None


class ServerError(Exception):
    code = 503


class BadRequest(Exception):
    code = 400


class FakeGrader:
    """Counts calls and can be told to fail. Names itself like a real grader."""

    def __init__(self, provider, outcomes=None, supports_vision=True):
        self.provider = provider
        self.outcomes = list(outcomes or [])
        self.calls = 0
        self.supports_vision = supports_vision

    async def score_essay(self, task_prompt, task_type, essay_text, task_image_url=None):
        self.calls += 1
        outcome = self.outcomes.pop(0) if self.outcomes else None
        if isinstance(outcome, Exception):
            raise outcome
        return {
            "status": "completed",
            "scores": {"overall": 6.5},
            "feedback": {"summary": f"from {self.provider}"},
            "raw_output": {},
            "processing_metadata": {"provider": self.provider, "elapsed_ms": 10},
            "model_descriptor": self.descriptor(),
        }

    def descriptor(self):
        return {
            "modelName": f"{self.provider}-model",
            "modelVersion": "2026-09-21-v1",
            "provider": self.provider,
            "taskType": "both",
            "configuration": {"system_prompt_sha256": "abc"},
        }


def trio(*outcome_lists):
    graders = [
        FakeGrader(name, outcomes)
        for name, outcomes in zip(("openai", "google", "qwen"), outcome_lists or ([], [], []))
    ]
    return graders


def rotating(graders, clock=None):
    return RotatingScorer(graders, cooldown_seconds=COOLDOWN, clock=clock)


async def score(rotator, essay="essay"):
    return await rotator.score_essay("prompt", "task_2", essay)


async def test_each_essay_goes_to_the_next_grader():
    graders = trio([], [], [])
    rotator = rotating(graders)

    served = [(await score(rotator, f"essay {i}"))["processing_metadata"]["provider"] for i in range(6)]

    assert served == ["openai", "google", "qwen", "openai", "google", "qwen"]
    assert [g.calls for g in graders] == [2, 2, 2]


async def test_a_rate_limited_grader_is_skipped_and_the_next_one_serves():
    graders = trio([RateLimited()], [], [])
    rotator = rotating(graders)

    result = await score(rotator)

    assert result["processing_metadata"]["provider"] == "google"
    assert graders[0].calls == 1


async def test_a_limited_grader_stays_out_for_the_cooldown():
    clock = FakeClock()
    graders = trio([RateLimited()], [], [])
    rotator = rotating(graders, clock=clock)

    await score(rotator, "one")                       # openai 429s, google serves
    clock.now += COOLDOWN - 1
    served = [(await score(rotator, f"e{i}"))["processing_metadata"]["provider"] for i in range(4)]

    assert "openai" not in served
    assert graders[0].calls == 1


async def test_a_limited_grader_comes_back_after_the_cooldown():
    clock = FakeClock()
    graders = trio([RateLimited()], [], [])
    rotator = rotating(graders, clock=clock)

    await score(rotator, "one")
    clock.now += COOLDOWN + 1
    served = {(await score(rotator, f"e{i}"))["processing_metadata"]["provider"] for i in range(3)}

    assert "openai" in served


async def test_the_cooldown_honours_a_retry_delay_the_provider_sent():
    clock = FakeClock()
    graders = trio([RateLimited(retry_after=30)], [], [])
    rotator = rotating(graders, clock=clock)

    await score(rotator, "one")
    clock.now += 31
    served = {(await score(rotator, f"e{i}"))["processing_metadata"]["provider"] for i in range(3)}

    assert "openai" in served


async def test_a_server_error_moves_on_to_the_next_grader():
    graders = trio([ServerError()], [], [])

    result = await score(rotating(graders))

    assert result["processing_metadata"]["provider"] == "google"


async def test_a_bad_request_takes_only_that_grader_out():
    """A 400 is usually one endpoint rejecting our shape, not a broken essay."""
    graders = trio([BadRequest()], [], [])

    result = await score(rotating(graders))

    assert result["processing_metadata"]["provider"] == "google"
    assert graders[1].calls == 1


async def test_our_own_bug_is_raised_without_spending_the_other_graders():
    graders = trio([TypeError("NoneType is not subscriptable")], [], [])

    with pytest.raises(TypeError):
        await score(rotating(graders))

    assert [g.calls for g in graders] == [1, 0, 0]


async def test_when_every_grader_fails_the_last_error_reaches_the_worker():
    """The worker's retry loop owns backoff; the submission stays retryable."""
    graders = trio([RateLimited()], [ServerError()], [RateLimited()])

    with pytest.raises(RateLimited):
        await score(rotating(graders))

    assert [g.calls for g in graders] == [1, 1, 1]


async def test_an_essay_arriving_while_everything_cools_down_raises():
    clock = FakeClock()
    graders = trio([RateLimited()], [RateLimited()], [RateLimited()])
    rotator = rotating(graders, clock=clock)

    with pytest.raises(RateLimited):
        await score(rotator, "one")

    with pytest.raises(RuntimeError, match="rate-limited"):
        await score(rotator, "two")

    assert [g.calls for g in graders] == [1, 1, 1]


async def test_every_result_names_the_grader_that_produced_it():
    graders = trio([], [], [])
    rotator = rotating(graders)

    for expected in ("openai", "google", "qwen"):
        result = await score(rotator, f"essay for {expected}")
        assert result["model_descriptor"]["provider"] == expected


async def test_the_descriptor_names_the_grader_that_last_ran():
    graders = trio([], [], [])
    rotator = rotating(graders)

    await score(rotator, "one")

    assert rotator.descriptor()["provider"] == "openai"


async def test_the_descriptor_after_a_failure_names_the_grader_that_failed():
    graders = trio([RateLimited()], [RateLimited()], [RateLimited()])
    rotator = rotating(graders)

    with pytest.raises(RateLimited):
        await score(rotator, "one")

    assert rotator.descriptor()["provider"] == "qwen"


async def test_a_single_grader_still_works():
    graders = [FakeGrader("openai")]

    result = await score(rotating(graders))

    assert result["processing_metadata"]["provider"] == "openai"


def test_an_empty_rotation_is_rejected_at_construction():
    with pytest.raises(ValueError, match="at least one candidate"):
        RotatingScorer([], cooldown_seconds=COOLDOWN)


# --- Task 1 chart/graph/diagram image ---------------------------------------


async def test_a_task_2_essay_is_unaffected_by_vision_capability():
    graders = trio([], [], [])
    graders[0].supports_vision = False
    rotator = rotating(graders)

    result = await rotator.score_essay("prompt", "task_2", "essay")

    assert result["processing_metadata"]["provider"] == "openai"


async def test_an_image_skips_a_grader_with_no_vision_support():
    graders = trio([], [], [])
    graders[0].supports_vision = False  # openai is first in rotation order

    result = await rotating(graders).score_essay("prompt", "task_1", "essay", "https://cdn/chart.png")

    assert result["processing_metadata"]["provider"] == "google"
    assert graders[0].calls == 0


async def test_a_skipped_grader_is_not_cooled_down_just_bypassed():
    """Wrong shape for an image is not the same as rate-limited: openai must
    still take its normal turn once the rotation cycles back to it."""
    graders = trio([], [], [])
    graders[0].supports_vision = False
    rotator = rotating(graders)

    await rotator.score_essay("prompt", "task_1", "essay one", "https://cdn/chart.png")  # google
    await rotator.score_essay("p", "task_2", "essay two")  # qwen
    served = (await rotator.score_essay("p", "task_2", "essay three"))["processing_metadata"]["provider"]

    assert served == "openai"
    assert graders[0].calls == 1


async def test_no_vision_capable_grader_raises_without_calling_anything():
    graders = trio([], [], [])
    for g in graders:
        g.supports_vision = False

    with pytest.raises(ValueError, match="vision"):
        await rotating(graders).score_essay("prompt", "task_1", "essay", "https://cdn/chart.png")

    assert [g.calls for g in graders] == [0, 0, 0]


async def test_a_cached_image_result_is_still_found_before_rotating(tmp_path):
    graders = trio([], [], [])
    cached = [CachedScorer(g, ScoringCache(tmp_path / g.provider)) for g in graders]
    rotator = rotating(cached)

    first = await rotator.score_essay("p", "task_1", "essay", "https://cdn/chart.png")
    second = await rotator.score_essay("p", "task_1", "essay", "https://cdn/chart.png")

    assert second["processing_metadata"]["cache_hit"] is True
    assert second["scores"] == first["scores"]


async def test_work_any_grader_already_did_is_not_paid_for_again(tmp_path):
    """Without this, re-scoring rotates to a new grader and pays again."""
    graders = trio([], [], [])
    cached = [
        CachedScorer(g, ScoringCache(tmp_path / g.provider)) for g in graders
    ]
    rotator = rotating(cached)

    first = await score(rotator, "the same essay")
    for _ in range(5):
        again = await score(rotator, "the same essay")
        assert again["processing_metadata"]["cache_hit"] is True
        assert again["scores"] == first["scores"]

    assert [g.calls for g in graders] == [1, 0, 0]


async def test_a_cache_hit_does_not_advance_the_rotation(tmp_path):
    graders = trio([], [], [])
    cached = [CachedScorer(g, ScoringCache(tmp_path / g.provider)) for g in graders]
    rotator = rotating(cached)

    await score(rotator, "essay one")          # openai scores it
    await score(rotator, "essay one")          # served from cache
    await score(rotator, "essay two")          # must be google, not qwen

    assert graders[1].calls == 1
    assert graders[2].calls == 0


async def test_a_cached_result_keeps_the_provenance_of_its_original_grader(tmp_path):
    graders = trio([], [], [])
    cached = [CachedScorer(g, ScoringCache(tmp_path / g.provider)) for g in graders]
    rotator = rotating(cached)

    await score(rotator, "essay one")
    hit = await score(rotator, "essay one")

    assert hit["model_descriptor"]["provider"] == "openai"
