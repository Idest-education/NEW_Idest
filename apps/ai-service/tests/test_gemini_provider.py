"""Exercises the Gemini call path against a fake SDK client."""

import asyncio
import json

import pytest
from providers.gemini import GeminiScorer

SCORED = {
    "scores": {
        "task_response": 7.0,
        "coherence_cohesion": 7.0,
        "lexical_resource": 6.5,
        "grammatical_range_accuracy": 6.5,
        "overall": 7.0,
    },
    "feedback": {
        "summary": "Well argued.",
        "strengths": ["Clear thesis"],
        "improvements": ["Tighter conclusion"],
        "sentence_feedback": [],
    },
}


class FakeUsage:
    prompt_token_count = 700
    candidates_token_count = 250
    total_token_count = 950


class FakeResponse:
    text = json.dumps(SCORED)
    usage_metadata = FakeUsage()


class FakeAsyncModels:
    """Records the call and yields to the event loop, as a real request would."""

    def __init__(self, delay=0.0, error=None):
        self.delay = delay
        self.error = error
        self.calls = []

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return FakeResponse()


class FakeSyncModels:
    """The surface that must no longer be reached."""

    def __init__(self):
        self.calls = 0

    def generate_content(self, **kwargs):
        self.calls += 1
        return FakeResponse()


class FakeClient:
    def __init__(self, delay=0.0, error=None):
        self.aio = type("Aio", (), {})()
        self.aio.models = FakeAsyncModels(delay=delay, error=error)
        self.models = FakeSyncModels()


def scorer_with(client) -> GeminiScorer:
    scorer = GeminiScorer(api_key="", model_name="gemini-3.6-flash")
    scorer.client = client
    return scorer


async def test_a_score_comes_back_in_the_shared_shape():
    scorer = scorer_with(FakeClient())

    result = await scorer.score_essay("Some task", "task_2", "essay body")

    assert result["status"] == "completed"
    assert result["scores"]["overall"] == 7.0
    assert result["feedback"]["summary"] == "Well argued."
    assert result["processing_metadata"]["provider"] == "google"
    assert result["processing_metadata"]["total_tokens"] == 950
    assert isinstance(result["processing_metadata"]["elapsed_ms"], int)


async def test_the_blocking_surface_is_never_used():
    client = FakeClient()

    await scorer_with(client).score_essay("t", "task_2", "e")

    assert client.models.calls == 0
    assert len(client.aio.models.calls) == 1


async def test_the_request_carries_the_prompt_and_the_schema():
    client = FakeClient()

    await scorer_with(client).score_essay("Some task", "task_1", "essay body")

    sent = client.aio.models.calls[0]
    assert sent["model"] == "gemini-3.6-flash"
    assert "<<<STUDENT_ESSAY>>>\nessay body\n<<<END_STUDENT_ESSAY>>>" in sent["contents"]
    assert sent["config"].response_mime_type == "application/json"
    assert "IELTS Writing Examiner" in sent["config"].system_instruction


async def test_the_event_loop_keeps_running_during_a_call():
    """A blocking call would starve the worker's timers and the broker heartbeat."""
    scorer = scorer_with(FakeClient(delay=0.05))
    ticks = 0

    async def heartbeat():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.005)
            ticks += 1

    beating = asyncio.create_task(heartbeat())
    await scorer.score_essay("t", "task_2", "e")
    beating.cancel()

    assert ticks > 0


async def test_two_essays_can_be_scored_concurrently():
    scorer = scorer_with(FakeClient(delay=0.05))

    results = await asyncio.gather(
        scorer.score_essay("t", "task_2", "one"),
        scorer.score_essay("t", "task_2", "two"),
    )

    assert [r["status"] for r in results] == ["completed", "completed"]
    assert len(scorer.client.aio.models.calls) == 2


async def test_a_provider_error_is_raised_for_the_worker_to_classify():
    class ApiError(Exception):
        code = 429

    scorer = scorer_with(FakeClient(error=ApiError("rate limited")))

    with pytest.raises(ApiError):
        await scorer.score_essay("t", "task_2", "e")


async def test_a_malformed_body_is_raised_and_not_scored():
    class BadResponse:
        text = "{not json"
        usage_metadata = None

    client = FakeClient()

    async def bad_call(**kwargs):
        return BadResponse()

    client.aio.models.generate_content = bad_call
    scorer = scorer_with(client)

    with pytest.raises(json.JSONDecodeError):
        await scorer.score_essay("t", "task_2", "e")


# --- thinking level ------------------------------------------------------------


def test_minimal_thinking_is_pinned_by_default():
    """Thinking tokens bill as output, so the level is never left to the model."""
    assert GeminiScorer(api_key="").thinking_level == "MINIMAL"


async def test_the_thinking_level_reaches_the_request():
    client = FakeClient()

    await scorer_with(client).score_essay("t", "task_2", "e")

    thinking = client.aio.models.calls[0]["config"].thinking_config
    assert thinking is not None
    assert thinking.thinking_level == "MINIMAL"


async def test_an_empty_level_sends_no_thinking_config():
    """Escape hatch for models that reject thinking_level with a 400."""
    client = FakeClient()
    scorer = GeminiScorer(api_key="", thinking_level="")
    scorer.client = client

    await scorer.score_essay("t", "task_2", "e")

    assert client.aio.models.calls[0]["config"].thinking_config is None


async def test_a_higher_level_can_be_asked_for():
    client = FakeClient()
    scorer = GeminiScorer(api_key="", thinking_level="HIGH")
    scorer.client = client

    await scorer.score_essay("t", "task_2", "e")

    assert client.aio.models.calls[0]["config"].thinking_config.thinking_level == "HIGH"


def test_the_thinking_level_is_part_of_grader_identity():
    """Two levels reason differently, so their results are not comparable."""
    minimal = GeminiScorer(api_key="", thinking_level="MINIMAL").descriptor()
    high = GeminiScorer(api_key="", thinking_level="HIGH").descriptor()

    assert minimal["configuration"]["thinking_level"] == "MINIMAL"
    assert high["configuration"]["thinking_level"] == "HIGH"
    assert minimal["configuration"] != high["configuration"]


def test_an_unset_level_is_recorded_as_none_not_as_an_empty_string():
    d = GeminiScorer(api_key="", thinking_level="").descriptor()

    assert d["configuration"]["thinking_level"] is None
