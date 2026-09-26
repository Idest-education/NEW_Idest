import hashlib

import pytest
from prompt import IELTS_SYSTEM_PROMPT, build_user_prompt
from providers.base import METADATA_KEYS, Scorer
from providers.gemini import GeminiScorer, token_counts as gemini_token_counts
from providers.ollama import OllamaScorer, token_counts as ollama_token_counts
from providers.stub import StubScorer


class FakeUsage:
    prompt_token_count = 812
    candidates_token_count = 219
    total_token_count = 1031


class FakeResponse:
    usage_metadata = FakeUsage()


def test_gemini_token_counts_reads_usage_metadata():
    assert gemini_token_counts(FakeResponse()) == {
        "prompt_tokens": 812,
        "completion_tokens": 219,
        "total_tokens": 1031,
    }


def test_gemini_token_counts_survives_missing_usage_metadata():
    class Bare:
        pass

    assert gemini_token_counts(Bare()) == {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
    }


def test_ollama_token_counts_maps_its_own_counter_names():
    assert ollama_token_counts({"prompt_eval_count": 800, "eval_count": 200}) == {
        "prompt_tokens": 800,
        "completion_tokens": 200,
        "total_tokens": 1000,
    }


def test_ollama_token_counts_survives_a_response_without_counters():
    assert ollama_token_counts({}) == {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
    }


async def test_stub_result_carries_the_shared_metadata_keys():
    result = await StubScorer().score_essay("prompt", "task_2", "essay")

    assert set(result["processing_metadata"]) == set(METADATA_KEYS)
    assert result["processing_metadata"]["provider"] == "google-stub"
    assert isinstance(result["processing_metadata"]["elapsed_ms"], int)


def test_every_provider_satisfies_the_scorer_protocol():
    for scorer in (GeminiScorer(api_key=""), OllamaScorer(), StubScorer()):
        assert isinstance(scorer, Scorer)


def test_descriptor_identifies_the_gemini_model():
    d = GeminiScorer(api_key="", model_name="gemini-3.6-flash").descriptor()

    assert d["modelName"] == "gemini-3.6-flash"
    assert d["provider"] == "google"
    assert d["taskType"] == "both"
    assert d["modelVersion"]


def test_descriptor_marks_stub_results_separately():
    d = StubScorer().descriptor()

    assert d["modelName"] == "stub-gemini-model"
    assert d["provider"] == "google-stub"


def test_a_local_model_never_shares_a_descriptor_with_gemini():
    """Local development results must not land in the benchmark as Gemini's."""
    gemini = GeminiScorer(api_key="", model_name="gemini-3.6-flash").descriptor()
    ollama = OllamaScorer(model_name="qwen2.5:7b-instruct").descriptor()

    assert ollama["provider"] == "ollama"
    assert (ollama["provider"], ollama["modelName"]) != (gemini["provider"], gemini["modelName"])


def test_the_ollama_descriptor_is_the_same_on_every_machine():
    """base_url is where the model ran, not which grader it is."""
    here = OllamaScorer(base_url="http://localhost:11434").descriptor()
    there = OllamaScorer(base_url="http://192.168.1.50:11434").descriptor()

    assert here == there


def test_every_provider_pins_the_prompt_by_the_same_hash():
    expected = hashlib.sha256(IELTS_SYSTEM_PROMPT.encode()).hexdigest()

    for scorer in (GeminiScorer(api_key=""), OllamaScorer(), StubScorer()):
        assert scorer.descriptor()["configuration"]["system_prompt_sha256"] == expected


def test_the_prompt_hash_is_the_one_past_results_were_scored_under():
    """A different digest here means ai_model_versions history just split.

    If this is a deliberate prompt change, bump SCORER_REVISION in the same
    commit and update this value.
    """
    assert (
        hashlib.sha256(IELTS_SYSTEM_PROMPT.encode()).hexdigest()
        == "8ad146800dabc27e8454f8727b77ac716f44cb999d266885595f72e12106f805"
    )


def test_the_user_prompt_delimits_the_essay():
    prompt = build_user_prompt("Some task", "task_1", "essay body")

    assert "<<<STUDENT_ESSAY>>>\nessay body\n<<<END_STUDENT_ESSAY>>>" in prompt
    assert "Task Type: task_1" in prompt


def test_the_scorer_revision_was_bumped_for_the_thinking_level():
    """Generation config is grader identity: pinning it needs a new revision.

    Results scored before the pin reasoned at the model's own default, so they
    belong to a different grader than results scored after it.
    """
    from config import SCORER_REVISION

    assert SCORER_REVISION != "2026-09-21-v1"
    for scorer in (GeminiScorer(api_key=""), OllamaScorer(), StubScorer()):
        assert scorer.descriptor()["modelVersion"] == SCORER_REVISION
