"""One grader for every endpoint that speaks the OpenAI chat completions API.

GPT, Qwen on DashScope, DeepSeek, GLM and OpenRouter all accept the same
request, so they differ only by base URL, key, model name and how strictly they
can be held to a JSON shape. Each instance is its own grader: `provider` and
`model_name` go into the descriptor, so their results never merge in
ai_model_versions.
"""

import json
import logging
import time

import httpx

from config import SCORER_REVISION
from prompt import IELTS_SYSTEM_PROMPT, build_schema_instruction, build_user_prompt
from providers.base import base_configuration, completed_result
from schemas import IELTSScoringResult

logger = logging.getLogger(__name__)

# How the endpoint is held to the scoring shape.
#   json_schema  - generation is constrained to the schema. Preferred.
#   json_object  - valid JSON guaranteed, shape only asked for in the prompt.
JSON_SCHEMA = "json_schema"
JSON_OBJECT = "json_object"
STRUCTURED_MODES = (JSON_SCHEMA, JSON_OBJECT)

SCHEMA_NAME = "ielts_scoring_result"


def token_counts(payload: dict) -> dict:
    """Usage from an OpenAI-shaped response, or nulls when it is absent."""
    usage = payload.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens")
    completion_tokens = usage.get("completion_tokens")
    total = usage.get("total_tokens")
    if total is None and (prompt_tokens is not None or completion_tokens is not None):
        total = (prompt_tokens or 0) + (completion_tokens or 0)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total,
    }


def strip_code_fence(text: str) -> str:
    """Removes a ```json fence some endpoints add around json_object replies."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    body = stripped.split("\n", 1)[1] if "\n" in stripped else ""
    if body.rstrip().endswith("```"):
        body = body.rstrip()[: -len("```")]
    return body.strip()


class OpenAICompatibleScorer:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_name: str,
        provider_name: str,
        structured_mode: str = JSON_SCHEMA,
        timeout: float = 120.0,
        temperature: float = 0.0,
    ):
        if structured_mode not in STRUCTURED_MODES:
            raise ValueError(
                f"structured_mode must be one of {STRUCTURED_MODES}, got {structured_mode!r}"
            )
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.provider_name = provider_name
        self.structured_mode = structured_mode
        self.timeout = timeout
        self.temperature = temperature

    @property
    def available(self) -> bool:
        """A key and a model name is all this provider needs to be usable.

        No startup probe: these are hosted endpoints, and spending a request to
        ask whether requests work would come out of the same quota the rotation
        exists to conserve.
        """
        return bool(self.api_key and self.model_name and self.base_url)

    def _response_format(self) -> dict:
        if self.structured_mode == JSON_SCHEMA:
            return {
                "type": "json_schema",
                "json_schema": {
                    "name": SCHEMA_NAME,
                    "strict": True,
                    "schema": IELTSScoringResult.model_json_schema(),
                },
            }
        return {"type": "json_object"}

    def _user_content(self, task_prompt: str, task_type: str, essay_text: str) -> str:
        content = build_user_prompt(task_prompt, task_type, essay_text)
        if self.structured_mode == JSON_OBJECT:
            content += build_schema_instruction(IELTSScoringResult.model_json_schema())
        return content

    async def score_essay(self, task_prompt: str, task_type: str, essay_text: str) -> dict:
        request = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": IELTS_SYSTEM_PROMPT},
                {"role": "user", "content": self._user_content(task_prompt, task_type, essay_text)},
            ],
            "response_format": self._response_format(),
            "temperature": self.temperature,
            "stream": False,
        }

        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=request,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
                response.raise_for_status()
                payload = response.json()

            elapsed_ms = int((time.perf_counter() - started) * 1000)
            content = payload["choices"][0]["message"]["content"]
            parsed_data = json.loads(strip_code_fence(content))
            return completed_result(
                scores=parsed_data.get("scores"),
                feedback=parsed_data.get("feedback"),
                raw_output=parsed_data,
                model_name=self.model_name,
                provider=self.provider_name,
                elapsed_ms=elapsed_ms,
                token_counts=token_counts(payload),
                descriptor=self.descriptor(),
            )
        except Exception as e:
            logger.error(f"{self.provider_name} scoring error: {e}")
            raise e

    def descriptor(self) -> dict:
        return {
            "modelName": self.model_name,
            "modelVersion": SCORER_REVISION,
            "provider": self.provider_name,
            "taskType": "both",
            # base_url stays out: it is where the request went, not which grader
            # answered, and a regional endpoint change must not split the row.
            # structured_mode is in, because it changes what the model was asked.
            "configuration": {
                **base_configuration(),
                "api": "openai_chat_completions",
                "response_format": self.structured_mode,
                "response_schema": "IELTSScoringResult",
                "temperature": self.temperature,
            },
        }
