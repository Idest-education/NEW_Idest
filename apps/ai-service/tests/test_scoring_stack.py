"""The composed stack: cache over throttle over provider, driven by the worker."""

import json

import pytest
from cache import CachedScorer, ScoringCache
from providers.throttled import ThrottledScorer
from rate_limit import RateLimiter
from worker import ScoringWorker

DESCRIPTOR = {
    "modelName": "gemini-3.6-flash",
    "modelVersion": "2026-09-21-v1",
    "provider": "google",
    "taskType": "both",
    "configuration": {"system_prompt_sha256": "abc"},
}


class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.slept = []

    def time(self):
        return self.now

    async def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


class CountingProvider:
    def __init__(self):
        self.calls = 0

    async def score_essay(self, task_prompt, task_type, essay_text, task_image_url=None):
        self.calls += 1
        return {
            "status": "completed",
            "scores": {"overall": 6.5},
            "feedback": {"summary": "ok"},
            "raw_output": {},
            "processing_metadata": {"provider": "google", "elapsed_ms": 3000},
        }

    def descriptor(self):
        return DESCRIPTOR


class FakeChannel:
    def __init__(self):
        self.published = []
        self.default_exchange = self

    async def publish(self, message, routing_key):
        self.published.append(json.loads(message.body.decode()))


@pytest.fixture
def stack(tmp_path):
    clock = FakeClock()
    provider = CountingProvider()
    throttled = ThrottledScorer(
        provider, RateLimiter(6.0, clock=clock.time, sleep=clock.sleep)
    )
    cached = CachedScorer(throttled, ScoringCache(tmp_path))
    return cached, provider, clock


async def test_a_real_call_waits_for_the_rate_floor(stack):
    cached, provider, clock = stack

    await cached.score_essay("prompt", "task_2", "essay one")
    await cached.score_essay("prompt", "task_2", "essay two")

    assert provider.calls == 2
    assert clock.slept == [6.0]


async def test_a_cached_result_waits_for_nothing(stack):
    """The point of putting the cache above the throttle."""
    cached, provider, clock = stack

    await cached.score_essay("prompt", "task_2", "essay")
    clock.slept.clear()

    for _ in range(20):
        await cached.score_essay("prompt", "task_2", "essay")

    assert provider.calls == 1
    assert clock.slept == []


async def test_a_cache_hit_does_not_push_back_the_next_real_call(stack):
    cached, provider, clock = stack

    await cached.score_essay("prompt", "task_2", "essay one")
    await cached.score_essay("prompt", "task_2", "essay one")  # hit
    clock.now += 6.0  # the rate floor has passed
    await cached.score_essay("prompt", "task_2", "essay two")

    assert provider.calls == 2
    assert clock.slept == []


async def test_the_worker_publishes_a_cached_score_with_its_provenance(stack):
    cached, provider, _ = stack
    worker = ScoringWorker(rabbitmq_url="amqp://unused", scorer=cached)
    channel = FakeChannel()
    job = {"submissionId": "sub-1", "taskPrompt": "prompt", "essayText": "essay"}

    await worker.process_job(channel, job)
    await worker.process_job(channel, job)

    first, second = channel.published
    assert provider.calls == 1
    assert first["status"] == second["status"] == "completed"
    assert first["scores"] == second["scores"]
    assert second["processingMetadata"]["cache_hit"] is True
    # Rule 3: every AI result records which grader produced it, cached or not.
    assert second["modelDescriptor"] == DESCRIPTOR


# --- the rotation, end to end through the worker -------------------------------


class NamedProvider:
    def __init__(self, provider, fail_with=None, supports_vision=True):
        self.provider = provider
        self.fail_with = fail_with
        self.calls = 0
        self.supports_vision = supports_vision

    async def score_essay(self, task_prompt, task_type, essay_text, task_image_url=None):
        self.calls += 1
        if self.fail_with is not None:
            raise self.fail_with
        return {
            "status": "completed",
            "scores": {"overall": 7.0},
            "feedback": {"summary": "ok"},
            "raw_output": {},
            "processing_metadata": {"provider": self.provider, "elapsed_ms": 50},
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


async def test_the_worker_records_whichever_grader_actually_scored(tmp_path):
    """Rule 3, under rotation: the published row names the model that ran."""
    from providers.rotating import RotatingScorer

    graders = [NamedProvider("openai"), NamedProvider("google"), NamedProvider("qwen")]
    worker = ScoringWorker(
        rabbitmq_url="amqp://unused",
        scorer=RotatingScorer(graders, cooldown_seconds=300.0),
    )
    channel = FakeChannel()

    for index in range(3):
        await worker.process_job(
            channel, {"submissionId": f"sub-{index}", "essayText": f"essay {index}"}
        )

    named = [p["modelDescriptor"]["provider"] for p in channel.published]
    assert named == ["openai", "google", "qwen"]
    assert all(p["status"] == "completed" for p in channel.published)


async def test_a_failed_rotation_still_names_a_grader_and_stays_failed(tmp_path):
    from providers.rotating import RotatingScorer

    class RateLimited(Exception):
        code = 429

    graders = [
        NamedProvider("openai", fail_with=RateLimited()),
        NamedProvider("google", fail_with=RateLimited()),
        NamedProvider("qwen", fail_with=RateLimited()),
    ]
    worker = ScoringWorker(
        rabbitmq_url="amqp://unused",
        scorer=RotatingScorer(graders, cooldown_seconds=300.0),
    )
    worker.sleep = lambda seconds: asyncio_sleep_noop()
    channel = FakeChannel()

    await worker.process_job(channel, {"submissionId": "sub-x", "essayText": "essay"})

    published = channel.published[0]
    assert published["status"] == "failed"
    assert published["modelDescriptor"]["provider"] in {"openai", "google", "qwen"}


async def asyncio_sleep_noop():
    return None
