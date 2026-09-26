"""Exercises the Ollama request and response shape without a live daemon."""

import json

import httpx
import pytest
from providers.ollama import OllamaScorer

SCORED = {
    "scores": {
        "task_response": 6.0,
        "coherence_cohesion": 6.5,
        "lexical_resource": 6.0,
        "grammatical_range_accuracy": 5.5,
        "overall": 6.0,
    },
    "feedback": {
        "summary": "Addresses the task.",
        "strengths": ["Clear position"],
        "improvements": ["Wider vocabulary"],
        "sentence_feedback": [],
    },
}


TAGS_URL = "http://localhost:11434/api/tags"


def tags_response(names):
    """A /api/tags reply with its request attached, as raise_for_status needs."""
    return httpx.Response(
        200,
        json={"models": [{"name": name} for name in names]},
        request=httpx.Request("GET", TAGS_URL),
    )


@pytest.fixture
def captured(monkeypatch):
    """Replaces the transport and hands back the request Ollama would have seen."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "message": {"content": json.dumps(SCORED)},
                "prompt_eval_count": 742,
                "eval_count": 301,
            },
        )

    original = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", patched)
    return seen


async def test_a_local_score_comes_back_in_the_shared_shape(captured):
    result = await OllamaScorer().score_essay("Some task", "task_2", "essay body")

    assert result["status"] == "completed"
    assert result["scores"]["overall"] == 6.0
    assert result["feedback"]["summary"] == "Addresses the task."
    assert result["processing_metadata"]["provider"] == "ollama"
    assert result["processing_metadata"]["total_tokens"] == 1043
    assert isinstance(result["processing_metadata"]["elapsed_ms"], int)


async def test_the_request_goes_to_the_chat_endpoint(captured):
    await OllamaScorer(base_url="http://localhost:11434/").score_essay("t", "task_2", "e")

    assert captured["url"] == "http://localhost:11434/api/chat"


async def test_generation_is_constrained_to_the_scoring_schema(captured):
    await OllamaScorer().score_essay("t", "task_2", "e")

    schema = captured["body"]["format"]
    assert schema["properties"].keys() == {"scores", "feedback"}
    assert captured["body"]["stream"] is False


async def test_scoring_the_same_essay_twice_cannot_drift(captured):
    await OllamaScorer().score_essay("t", "task_2", "e")

    assert captured["body"]["options"]["temperature"] == 0


async def test_the_essay_is_sent_inside_its_delimiters(captured):
    await OllamaScorer().score_essay("Some task", "task_1", "essay body")

    system, user = captured["body"]["messages"]
    assert system["role"] == "system"
    assert "IELTS Writing Examiner" in system["content"]
    assert "<<<STUDENT_ESSAY>>>\nessay body\n<<<END_STUDENT_ESSAY>>>" in user["content"]


async def test_an_http_error_is_raised_for_the_worker_to_classify(monkeypatch):
    def handler(request):
        return httpx.Response(503, text="model is loading")

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: original(*a, **{**kw, "transport": httpx.MockTransport(handler)}),
    )

    with pytest.raises(httpx.HTTPStatusError) as raised:
        await OllamaScorer().score_essay("t", "task_2", "e")

    assert raised.value.response.status_code == 503


def test_an_unreachable_daemon_reads_as_unavailable(monkeypatch):
    def refuse(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "get", refuse)

    assert OllamaScorer().available is False


def test_a_missing_model_reads_as_unavailable(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **kw: tags_response(["llama3.1:8b"]))

    assert OllamaScorer(model_name="qwen2.5:7b-instruct").available is False


def test_an_installed_model_reads_as_available(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **kw: tags_response(["qwen2.5:7b-instruct"]))

    assert OllamaScorer(model_name="qwen2.5:7b-instruct").available is True


def test_an_untagged_model_name_matches_the_latest_tag(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **kw: tags_response(["llama3.1:latest"]))

    assert OllamaScorer(model_name="llama3.1").available is True
