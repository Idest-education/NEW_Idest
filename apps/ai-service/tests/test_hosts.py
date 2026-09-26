"""Host presets for the third grader."""

import pytest
from providers.hosts import DEFAULT_HOST, HOSTS, resolve
from providers.openai_compatible import JSON_OBJECT, JSON_SCHEMA, STRUCTURED_MODES


@pytest.fixture(autouse=True)
def no_host_keys(monkeypatch):
    for host in HOSTS.values():
        monkeypatch.delenv(host.key_env, raising=False)


def test_the_default_host_is_hugging_face():
    assert DEFAULT_HOST == "huggingface"
    assert HOSTS[DEFAULT_HOST].base_url == "https://router.huggingface.co/v1"


def test_every_preset_declares_a_valid_structured_mode():
    for host in HOSTS.values():
        assert host.structured_mode in STRUCTURED_MODES


def test_every_preset_names_the_env_var_holding_its_key():
    for host in HOSTS.values():
        assert host.key_env


def test_hugging_face_and_openrouter_can_be_held_to_the_schema():
    assert HOSTS["huggingface"].structured_mode == JSON_SCHEMA
    assert HOSTS["openrouter"].structured_mode == JSON_SCHEMA


def test_hosts_without_documented_schema_support_ask_in_the_prompt():
    assert HOSTS["deepseek"].structured_mode == JSON_OBJECT
    assert HOSTS["dashscope"].structured_mode == JSON_OBJECT


def test_region_scoped_hosts_ship_no_endpoint_default():
    """Guessing a region would send a valid key to the wrong one."""
    assert HOSTS["dashscope"].base_url == ""
    assert HOSTS["custom"].base_url == ""


def test_an_unknown_host_resolves_to_none():
    assert resolve("not-a-host") is None


def test_a_preset_fills_in_the_endpoint_and_model():
    host, key, base_url, model, mode = resolve("huggingface")

    assert host.label == "huggingface"
    assert base_url == "https://router.huggingface.co/v1"
    assert model == "Qwen/Qwen3.8-27B"
    assert mode == JSON_SCHEMA


def test_the_key_comes_from_the_hosts_own_env_var(monkeypatch):
    """An existing HF_TOKEN works without being copied into CN_API_KEY."""
    monkeypatch.setenv("HF_TOKEN", "hf-abc")

    _, key, _, _, _ = resolve("huggingface")

    assert key == "hf-abc"


def test_an_explicit_key_wins_over_the_hosts_env_var(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf-abc")

    _, key, _, _, _ = resolve("huggingface", api_key="explicit")

    assert key == "explicit"


def test_every_field_can_be_overridden():
    host, key, base_url, model, mode = resolve(
        "openrouter",
        api_key="k",
        base_url="https://example.test/v1",
        model="qwen/qwen3.8-27b:free",
        structured_mode=JSON_OBJECT,
    )

    assert (base_url, model, mode) == ("https://example.test/v1", "qwen/qwen3.8-27b:free", JSON_OBJECT)
    assert host.label == "openrouter"


def test_the_host_name_is_case_and_space_tolerant():
    assert resolve("  HuggingFace  ")[0].label == "huggingface"


def test_each_host_is_a_distinct_grader():
    """The same weights served two ways are two graders, never one row."""
    labels = {host.label for host in HOSTS.values()}

    assert len(labels) == len(HOSTS)
