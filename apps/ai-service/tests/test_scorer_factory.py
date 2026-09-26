import pytest
import scorer as factory
from cache import CachedScorer
from providers.gemini import GeminiScorer
from providers.ollama import OllamaScorer
from providers.stub import StubScorer
from providers.openai_compatible import OpenAICompatibleScorer
from providers.rotating import RotatingScorer
from providers.throttled import ThrottledScorer


@pytest.fixture(autouse=True)
def no_keys(monkeypatch):
    """No hosted grader is configured unless a test says so.

    The third slot's key can also come from the host's own env var, so those are
    cleared too — otherwise a developer's exported HF_TOKEN changes the outcome.
    """
    for name in ("OPENAI_API_KEY", "GEMINI_API_KEY", "CN_API_KEY"):
        monkeypatch.setattr(factory, name, "")
    for env in ("HF_TOKEN", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY"):
        monkeypatch.delenv(env, raising=False)
    # The third slot's overrides are cleared too, so these tests assert what the
    # host presets do rather than whatever is in the developer's .env.
    for name in ("CN_BASE_URL", "CN_MODEL", "CN_STRUCTURED_MODE"):
        monkeypatch.setattr(factory, name, "")
    monkeypatch.setattr(factory, "CN_HOST", "huggingface")


@pytest.fixture
def no_gemini_key(monkeypatch):
    monkeypatch.setattr(factory, "GEMINI_API_KEY", "")


@pytest.fixture
def gemini_key(monkeypatch):
    monkeypatch.setattr(factory, "GEMINI_API_KEY", "test-key")


@pytest.fixture
def all_three_keys(monkeypatch):
    for name in ("OPENAI_API_KEY", "GEMINI_API_KEY", "CN_API_KEY"):
        monkeypatch.setattr(factory, name, f"test-{name}")


def _force(monkeypatch, cls, available: bool):
    monkeypatch.setattr(cls, "available", property(lambda self: available))


def test_an_unset_provider_picks_gemini_when_a_key_exists(monkeypatch, gemini_key):
    _force(monkeypatch, GeminiScorer, True)

    assert isinstance(factory.build_provider("")[0], GeminiScorer)


def test_an_unset_provider_falls_back_to_the_stub_without_a_key(no_gemini_key):
    assert isinstance(factory.build_provider("")[0], StubScorer)


def test_ollama_is_selected_by_name(monkeypatch):
    _force(monkeypatch, OllamaScorer, True)

    assert isinstance(factory.build_provider("ollama")[0], OllamaScorer)


def test_an_unreachable_ollama_does_not_stop_the_service(monkeypatch):
    _force(monkeypatch, OllamaScorer, False)

    assert isinstance(factory.build_provider("ollama")[0], StubScorer)


def test_an_unusable_gemini_does_not_stop_the_service(monkeypatch, gemini_key):
    _force(monkeypatch, GeminiScorer, False)

    assert isinstance(factory.build_provider("gemini")[0], StubScorer)


def test_the_provider_name_is_case_and_space_tolerant(monkeypatch):
    _force(monkeypatch, OllamaScorer, True)

    assert isinstance(factory.build_provider("ollama")[0], OllamaScorer)
    assert factory._resolve_name("OLLAMA".strip().lower()) == "ollama"


def test_an_unknown_provider_name_does_not_silently_become_gemini(no_gemini_key):
    assert isinstance(factory.build_provider("mistral")[0], StubScorer)


def test_the_scorer_is_wrapped_in_the_cache_by_default(tmp_path, no_gemini_key):
    built = factory.build_scorer("stub", cache_enabled=True, cache_dir=str(tmp_path))

    assert isinstance(built, CachedScorer)
    assert isinstance(built.inner, StubScorer)


def test_the_cache_can_be_turned_off(tmp_path, no_gemini_key):
    built = factory.build_scorer("stub", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert isinstance(built, StubScorer)


def test_wrapping_does_not_change_the_recorded_grader(tmp_path, no_gemini_key):
    provider, _ = factory.build_provider("stub")
    wrapped = factory.build_scorer("stub", cache_enabled=True, cache_dir=str(tmp_path))

    assert wrapped.descriptor() == provider.descriptor()


def test_a_metered_provider_is_throttled_beneath_the_cache(monkeypatch, gemini_key, tmp_path):
    """A cached result must not wait for a rate limit it does not consume."""
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer(
        "gemini", cache_enabled=True, cache_dir=str(tmp_path), min_seconds_between_calls=6.0
    )

    assert isinstance(built, CachedScorer)
    assert isinstance(built.inner, ThrottledScorer)
    assert isinstance(built.inner.inner, GeminiScorer)


def test_the_throttle_carries_the_configured_interval(monkeypatch, gemini_key, tmp_path):
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer(
        "gemini", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=6.0
    )

    assert built.limiter.min_interval == 6.0


def test_a_free_local_provider_is_not_throttled(monkeypatch, tmp_path):
    """Ollama costs no quota, and prefetch_count=1 already serialises the work."""
    _force(monkeypatch, OllamaScorer, True)

    built = factory.build_scorer(
        "ollama", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=6.0
    )

    assert isinstance(built, OllamaScorer)


def test_the_stub_is_not_throttled(tmp_path, no_gemini_key):
    built = factory.build_scorer(
        "stub", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=6.0
    )

    assert isinstance(built, StubScorer)


def test_a_zero_interval_leaves_the_throttle_out(monkeypatch, gemini_key, tmp_path):
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer(
        "gemini", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0
    )

    assert isinstance(built, GeminiScorer)


# --- rotation -----------------------------------------------------------------


def providers_in(rotator) -> list[str]:
    return [c.descriptor()["provider"] for c in rotator.candidates]


def unwrap(scorer):
    """Peels the cache and throttle layers off to reach the bare provider."""
    while hasattr(scorer, "inner"):
        scorer = scorer.inner
    return scorer


def test_two_configured_keys_start_a_rotation_on_their_own(all_three_keys, tmp_path, monkeypatch):
    """Adding a key is all it takes to widen the rotation."""
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer("", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert isinstance(built, RotatingScorer)
    assert providers_in(built) == ["openai", "google", "huggingface"]


def test_the_rotation_is_gpt_then_gemini_then_the_third_host(all_three_keys, tmp_path, monkeypatch):
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer("rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert [type(unwrap(c)).__name__ for c in built.candidates] == [
        "OpenAICompatibleScorer",
        "GeminiScorer",
        "OpenAICompatibleScorer",
    ]
    assert [unwrap(c).model_name for c in built.candidates] == [
        "gpt-5-mini",
        factory.GeminiScorer().model_name,
        "Qwen/Qwen3.8-27B",
    ]


def test_each_rotation_member_gets_its_own_cache_and_throttle(all_three_keys, tmp_path, monkeypatch):
    """Per-grader caches, because a cache key includes the grader's identity."""
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer(
        "rotate", cache_enabled=True, cache_dir=str(tmp_path), min_seconds_between_calls=6.0
    )

    for candidate in built.candidates:
        assert isinstance(candidate, CachedScorer)
        assert isinstance(candidate.inner, ThrottledScorer)
        assert candidate.inner.limiter.min_interval == 6.0


def test_a_key_that_is_missing_is_left_out_of_the_rotation(tmp_path, monkeypatch):
    monkeypatch.setattr(factory, "OPENAI_API_KEY", "k")
    monkeypatch.setattr(factory, "CN_API_KEY", "k")

    built = factory.build_scorer("rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert providers_in(built) == ["openai", "huggingface"]


def test_one_configured_key_needs_no_rotation_layer(tmp_path, monkeypatch):
    monkeypatch.setattr(factory, "OPENAI_API_KEY", "k")

    built = factory.build_scorer("rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert isinstance(unwrap(built), OpenAICompatibleScorer)


def test_a_rotation_with_no_keys_at_all_falls_back_to_the_stub(tmp_path):
    built = factory.build_scorer("rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert isinstance(unwrap(built), StubScorer)


def test_a_single_key_does_not_start_a_rotation(gemini_key, tmp_path, monkeypatch):
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer("", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert isinstance(unwrap(built), GeminiScorer)


def test_naming_one_provider_overrides_the_rotation(all_three_keys, tmp_path, monkeypatch):
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer("gemini", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert isinstance(unwrap(built), GeminiScorer)


def test_the_default_third_host_constrains_generation_to_the_schema(all_three_keys, tmp_path):
    """Hugging Face's router supports json_schema, so use the stricter mode."""
    built = factory.build_scorer(
        "cn", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0
    )

    assert built.descriptor()["provider"] == "huggingface"
    assert built.descriptor()["configuration"]["response_format"] == "json_schema"


def test_gpt_constrains_generation_to_the_schema(all_three_keys, tmp_path):
    built = factory.build_scorer("openai", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)

    assert built.descriptor()["configuration"]["response_format"] == "json_schema"


def test_every_rotation_member_is_a_distinct_grader(all_three_keys, tmp_path, monkeypatch):
    """Three graders must mean three ai_model_versions rows, never fewer."""
    _force(monkeypatch, GeminiScorer, True)

    built = factory.build_scorer("rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0)
    identities = {
        (c.descriptor()["provider"], c.descriptor()["modelName"]) for c in built.candidates
    }

    assert len(identities) == 3


def test_dashscope_without_an_endpoint_is_not_usable(monkeypatch):
    """Model Studio endpoints are region-scoped; guessing one fails as a 404."""
    monkeypatch.setattr(factory, "CN_HOST", "dashscope")
    monkeypatch.setattr(factory, "CN_API_KEY", "k")

    assert factory._build_one(factory.CN) is None


def test_dashscope_with_an_endpoint_is_usable(monkeypatch):
    monkeypatch.setattr(factory, "CN_HOST", "dashscope")
    monkeypatch.setattr(factory, "CN_API_KEY", "k")
    monkeypatch.setattr(
        factory,
        "CN_BASE_URL",
        "https://ws-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    )

    built = factory._build_one(factory.CN)

    assert built is not None
    assert built.descriptor()["provider"] == "dashscope"
    assert built.model_name == "qwen3-235b-a22b"


def test_a_third_host_without_an_endpoint_drops_out_of_the_rotation(monkeypatch, tmp_path):
    monkeypatch.setattr(factory, "OPENAI_API_KEY", "k")
    monkeypatch.setattr(factory, "CN_HOST", "dashscope")
    monkeypatch.setattr(factory, "CN_API_KEY", "k")

    built = factory.build_scorer(
        "rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0
    )

    assert isinstance(unwrap(built), OpenAICompatibleScorer)
    assert unwrap(built).descriptor()["provider"] == "openai"


def test_an_unknown_host_leaves_the_third_grader_out(monkeypatch, tmp_path):
    monkeypatch.setattr(factory, "OPENAI_API_KEY", "k")
    monkeypatch.setattr(factory, "CN_HOST", "definitely-not-a-host")
    monkeypatch.setattr(factory, "CN_API_KEY", "k")

    built = factory.build_scorer(
        "rotate", cache_enabled=False, cache_dir=str(tmp_path), min_seconds_between_calls=0.0
    )

    assert unwrap(built).descriptor()["provider"] == "openai"
