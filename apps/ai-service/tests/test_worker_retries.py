import json
import pytest
from worker import ScoringWorker

OK_RESULT = {
    "status": "completed",
    "scores": {"overall": 6.5},
    "feedback": {"summary": "fine"},
    "raw_output": {},
    "processing_metadata": {},
}


class ApiError(Exception):
    def __init__(self, code, details=None):
        super().__init__(f"{code} error")
        self.code = code
        self.details = details


class FakeScorer:
    """Replays a scripted sequence of outcomes, counting the calls made."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    async def score_essay(self, task_prompt, task_type, essay_text, task_image_url=None):
        self.calls += 1
        outcome = self.outcomes.pop(0) if self.outcomes else OK_RESULT
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def descriptor(self):
        return {"modelName": "fake", "modelVersion": "test"}


class FakeChannel:
    def __init__(self):
        self.published = []
        self.default_exchange = self

    async def publish(self, message, routing_key):
        self.published.append((json.loads(message.body.decode()), routing_key))


@pytest.fixture
def worker(monkeypatch):
    worker = ScoringWorker(rabbitmq_url="amqp://unused", scorer=FakeScorer([]))
    worker.slept = []

    async def record_sleep(seconds):
        worker.slept.append(seconds)

    worker.sleep = record_sleep
    worker.jitter = lambda: 1.0
    return worker


async def test_a_rate_limit_is_waited_out_then_the_retry_succeeds(worker):
    worker.scorer = FakeScorer([ApiError(429, details={"retryDelay": "9s"}), OK_RESULT])

    result = await worker.score_with_retries("sub-1", "prompt", "task_2", "essay")

    assert result["status"] == "completed"
    assert worker.slept == [9.0]
    assert worker.scorer.calls == 2


async def test_backoff_grows_between_attempts_without_retry_advice(worker, monkeypatch):
    monkeypatch.setattr("worker.MAX_RETRIES", 3)
    worker.scorer = FakeScorer([ApiError(503), ApiError(503), OK_RESULT])

    result = await worker.score_with_retries("sub-2", "prompt", "task_2", "essay")

    assert result["status"] == "completed"
    assert worker.slept == [2.0, 4.0]


async def test_a_bad_request_is_not_retried_at_all(worker):
    worker.scorer = FakeScorer([ApiError(400), OK_RESULT])

    result = await worker.score_with_retries("sub-3", "prompt", "task_2", "essay")

    assert result["status"] == "failed"
    assert "Not retryable" in result["feedback"]["error"]
    assert worker.scorer.calls == 1
    assert worker.slept == []


async def test_a_wait_longer_than_the_ceiling_ends_the_job(worker):
    worker.scorer = FakeScorer([ApiError(429, details={"retryDelay": "3600s"})])

    result = await worker.score_with_retries("sub-4", "prompt", "task_2", "essay")

    assert result["status"] == "failed"
    assert worker.scorer.calls == 1
    assert worker.slept == []


async def test_attempts_stop_at_max_retries(worker, monkeypatch):
    monkeypatch.setattr("worker.MAX_RETRIES", 3)
    worker.scorer = FakeScorer([ApiError(503), ApiError(503), ApiError(503)])

    result = await worker.score_with_retries("sub-5", "prompt", "task_2", "essay")

    assert result["status"] == "failed"
    assert "Maximum retries (3) exceeded" in result["feedback"]["error"]
    assert worker.scorer.calls == 3
    assert len(worker.slept) == 2  # no sleep after the final failure


async def test_a_single_attempt_still_runs_when_retries_are_disabled(worker, monkeypatch):
    monkeypatch.setattr("worker.MAX_RETRIES", 0)
    worker.scorer = FakeScorer([OK_RESULT])

    result = await worker.score_with_retries("sub-6", "prompt", "task_2", "essay")

    assert result["status"] == "completed"
    assert worker.scorer.calls == 1


async def test_a_failed_job_still_publishes_a_result(worker):
    worker.scorer = FakeScorer([ApiError(400)])
    channel = FakeChannel()

    await worker.process_job(channel, {"submissionId": "sub-8", "essayText": "essay"})

    payload, routing_key = channel.published[0]
    assert routing_key == "ai_scoring_results_queue"
    assert payload["status"] == "failed"
    assert payload["submissionId"] == "sub-8"
    assert payload["modelDescriptor"]["modelName"] == "fake"
