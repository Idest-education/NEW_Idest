"""Exercises the OpenAI-compatible request and response shape without a network."""

import json

import httpx
import pytest
from providers.openai_compatible import (
    JSON_OBJECT,
    JSON_SCHEMA,
    OpenAICompatibleScorer,
    strip_code_fence,
    token_counts,
)

SCORED = {
    "scores": {
        "task_response": 6.5,
        "coherence_cohesion": 6.0,
        "lexical_resource": 6.5,
        "grammatical_range_accuracy": 6.0,
        "overall": 6.5,
    },
    "feedback": {
        "summary": "Clear but repetitive.",
        "strengths": ["Coherent paragraphs"],
        "improvements": ["Vary sentence length"],
        "sentence_feedback": [],
    },
}


def gpt(**kwargs) -> OpenAICompatibleScorer:
    defaults = dict(
        base_url="https://api.openai.com/v1",
        api_key="test-key",
        model_name="gpt-5-mini",
        provider_name="openai",
    )
    return OpenAICompatibleScorer(**{**defaults, **kwargs})


@pytest.fixture
def captured(monkeypatch):
    """Replaces the transport and hands back the request the endpoint would see."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(SCORED)}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 400, "total_tokens": 1300},
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: original(*a, **{**kw, "transport": httpx.MockTransport(handler)}),
    )
    return seen


async def test_a_score_comes_back_in_the_shared_shape(captured):
    result = await gpt().score_essay("Some task", "task_2", "essay body")

    assert result["status"] == "completed"
    assert result["scores"]["overall"] == 6.5
    assert result["processing_metadata"]["provider"] == "openai"
    assert result["processing_metadata"]["model_name"] == "gpt-5-mini"
    assert result["processing_metadata"]["total_tokens"] == 1300


async def test_the_result_carries_its_own_provenance(captured):
    """Rule 3: rotation means the result must name its grader itself."""
    result = await gpt().score_essay("t", "task_2", "e")

    assert result["model_descriptor"]["provider"] == "openai"
    assert result["model_descriptor"]["modelName"] == "gpt-5-mini"


async def test_the_request_goes_to_chat_completions_with_the_key(captured):
    await gpt(base_url="https://api.deepseek.com/v1/").score_essay("t", "task_2", "e")

    assert captured["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert captured["auth"] == "Bearer test-key"


async def test_json_schema_mode_constrains_generation(captured):
    await gpt(structured_mode=JSON_SCHEMA).score_essay("t", "task_2", "e")

    fmt = captured["body"]["response_format"]
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["strict"] is True
    assert fmt["json_schema"]["schema"]["properties"].keys() == {"scores", "feedback"}


async def test_json_object_mode_asks_for_the_shape_in_the_prompt(captured):
    """Endpoints without strict schema support still need to know the shape."""
    await gpt(structured_mode=JSON_OBJECT).score_essay("t", "task_2", "e")

    assert captured["body"]["response_format"] == {"type": "json_object"}
    user = captured["body"]["messages"][1]["content"]
    assert "must validate against this JSON Schema" in user
    assert '"grammatical_range_accuracy"' in user


async def test_json_schema_mode_does_not_repeat_the_schema_in_the_prompt(captured):
    await gpt(structured_mode=JSON_SCHEMA).score_essay("t", "task_2", "e")

    assert "must validate against this JSON Schema" not in captured["body"]["messages"][1]["content"]


async def test_scoring_the_same_essay_twice_cannot_drift(captured):
    await gpt().score_essay("t", "task_2", "e")

    assert captured["body"]["temperature"] == 0.0
    assert captured["body"]["stream"] is False


async def test_the_essay_is_sent_inside_its_delimiters(captured):
    await gpt().score_essay("Some task", "task_1", "essay body")

    system, user = captured["body"]["messages"]
    assert "IELTS Writing Examiner" in system["content"]
    assert "<<<STUDENT_ESSAY>>>\nessay body\n<<<END_STUDENT_ESSAY>>>" in user["content"]


async def test_an_http_error_is_raised_for_the_caller_to_classify(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: original(
            *a,
            **{**kw, "transport": httpx.MockTransport(lambda r: httpx.Response(429, text="slow down"))},
        ),
    )

    with pytest.raises(httpx.HTTPStatusError) as raised:
        await gpt().score_essay("t", "task_2", "e")

    assert raised.value.response.status_code == 429


async def test_a_fenced_reply_still_parses(monkeypatch):
    """Some json_object endpoints wrap the object in a markdown fence."""
    fenced = "```json\n" + json.dumps(SCORED) + "\n```"
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: original(
            *a,
            **{
                **kw,
                "transport": httpx.MockTransport(
                    lambda r: httpx.Response(200, json={"choices": [{"message": {"content": fenced}}]})
                ),
            },
        ),
    )

    result = await gpt(structured_mode=JSON_OBJECT).score_essay("t", "task_2", "e")

    assert result["scores"]["overall"] == 6.5


def test_strip_code_fence_leaves_plain_json_alone():
    assert strip_code_fence('  {"a": 1}  ') == '{"a": 1}'


def test_token_counts_derives_a_missing_total():
    assert token_counts({"usage": {"prompt_tokens": 10, "completion_tokens": 5}})["total_tokens"] == 15


def test_token_counts_survives_a_response_without_usage():
    assert token_counts({}) == {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
    }


def test_a_provider_without_a_key_is_not_available():
    assert gpt(api_key="").available is False
    assert gpt().available is True


def test_an_unknown_structured_mode_is_rejected_at_construction():
    with pytest.raises(ValueError, match="structured_mode"):
        gpt(structured_mode="yaml")


def test_two_endpoints_are_two_different_graders():
    """Qwen results must never merge with GPT results in ai_model_versions."""
    openai = gpt().descriptor()
    qwen = gpt(
        base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model_name="qwen3-235b-a22b",
        provider_name="qwen",
        structured_mode=JSON_OBJECT,
    ).descriptor()

    assert (openai["provider"], openai["modelName"]) != (qwen["provider"], qwen["modelName"])
    assert qwen["configuration"]["response_format"] == "json_object"


def test_the_descriptor_is_the_same_on_every_machine():
    """A regional endpoint change must not split one grader's history."""
    a = gpt(base_url="https://api.openai.com/v1").descriptor()
    b = gpt(base_url="https://eu.api.openai.com/v1").descriptor()

    assert a == b
