"""Known hosts for the third grader in the rotation.

The third slot is an open-weight Chinese model, and several hosts serve the same
weights. Only four things differ between them: the endpoint, which env var holds
the key, how strictly the endpoint can be held to a JSON shape, and a sensible
default model. Everything else is the same OpenAI chat completions request.

`provider` in the descriptor is the HOST, not just the model family. The same
weights served by two hosts can be quantised differently and score differently,
so they are two graders and must not share one ai_model_versions row.
"""

import os
from dataclasses import dataclass

from providers.openai_compatible import JSON_OBJECT, JSON_SCHEMA


@dataclass(frozen=True)
class Host:
    label: str
    base_url: str
    key_env: str
    default_model: str
    structured_mode: str
    note: str = ""


HOSTS: dict[str, Host] = {
    # Routes to whichever serverless provider is cheapest or preferred. Supports
    # both json_schema and json_object. Free monthly credit is $0.10 ($2.00 on
    # PRO), so treat this as pay-as-you-go, not as a free tier.
    "huggingface": Host(
        label="huggingface",
        base_url="https://router.huggingface.co/v1",
        key_env="HF_TOKEN",
        default_model="Qwen/Qwen3.8-27B",
        structured_mode=JSON_SCHEMA,
        note="append :cheapest to the model id to pick the cheapest serving provider",
    ),
    # One key for every model on the board, including a couple of genuinely free
    # ones with daily caps.
    "openrouter": Host(
        label="openrouter",
        base_url="https://openrouter.ai/api/v1",
        key_env="OPENROUTER_API_KEY",
        default_model="qwen/qwen3.8-27b",
        structured_mode=JSON_SCHEMA,
        note="model ids ending :free have daily caps and cost nothing",
    ),
    "deepseek": Host(
        label="deepseek",
        base_url="https://api.deepseek.com/v1",
        key_env="DEEPSEEK_API_KEY",
        default_model="deepseek-chat",
        structured_mode=JSON_OBJECT,
    ),
    # Alibaba Model Studio. No endpoint default: keys and endpoints are
    # per-region and most regions put the workspace id in the host.
    "dashscope": Host(
        label="dashscope",
        base_url="",
        key_env="DASHSCOPE_API_KEY",
        default_model="qwen3-235b-a22b",
        structured_mode=JSON_OBJECT,
    ),
    # Everything comes from CN_BASE_URL / CN_MODEL / CN_API_KEY.
    "custom": Host(
        label="custom",
        base_url="",
        key_env="CN_API_KEY",
        default_model="",
        structured_mode=JSON_OBJECT,
    ),
}

DEFAULT_HOST = "huggingface"


def resolve(
    host_name: str,
    api_key: str = "",
    base_url: str = "",
    model: str = "",
    structured_mode: str = "",
) -> tuple[Host, str, str, str, str] | None:
    """A host preset with the explicit overrides applied, or None if unknown.

    Returns (host, api_key, base_url, model, structured_mode). The key comes
    from CN_API_KEY when set, otherwise from the host's own env var, so an
    existing HF_TOKEN or OPENROUTER_API_KEY works without being copied.
    """
    host = HOSTS.get(host_name.strip().lower())
    if host is None:
        return None
    return (
        host,
        api_key or os.getenv(host.key_env, ""),
        base_url or host.base_url,
        model or host.default_model,
        structured_mode or host.structured_mode,
    )
