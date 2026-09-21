from scorer import GeminiIELTSScorer, _token_counts

METADATA_KEYS = {
    "model_name",
    "provider",
    "elapsed_ms",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
}


class FakeUsage:
    prompt_token_count = 812
    candidates_token_count = 219
    total_token_count = 1031


class FakeResponse:
    usage_metadata = FakeUsage()


def test_token_counts_reads_usage_metadata():
    assert _token_counts(FakeResponse()) == {
        "prompt_tokens": 812,
        "completion_tokens": 219,
        "total_tokens": 1031,
    }


def test_token_counts_survives_missing_usage_metadata():
    class Bare:
        pass

    assert _token_counts(Bare()) == {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
    }


def test_stub_result_carries_the_same_metadata_keys():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")
    result = scorer._generate_stub_result("prompt", "essay")

    assert set(result["processing_metadata"]) == METADATA_KEYS
    assert result["processing_metadata"]["provider"] == "google-stub"
    assert isinstance(result["processing_metadata"]["elapsed_ms"], int)
