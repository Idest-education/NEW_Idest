"""Ollama grader. A local model, so development spends no provider quota.

Results from here carry provider "ollama" and never merge with Gemini results
in ai_model_versions. Keep them out of the benchmark: a 7B local model is a
development convenience, not the grader the thesis evaluates.
"""

import base64
import json
import logging
import time

import httpx

from config import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_SUPPORTS_VISION,
    OLLAMA_TIMEOUT_SECONDS,
    SCORER_REVISION,
)
from image_fetch import fetch_task_image
from prompt import IELTS_SYSTEM_PROMPT, build_user_prompt
from providers.base import base_configuration, completed_result, ensure_vision_capable
from schemas import IELTSScoringResult

logger = logging.getLogger(__name__)

PROVIDER = "ollama"


def token_counts(payload: dict) -> dict:
    """Ollama's own counter names, mapped onto the shared metadata keys."""
    prompt_tokens = payload.get("prompt_eval_count")
    completion_tokens = payload.get("eval_count")
    total = None
    if prompt_tokens is not None or completion_tokens is not None:
        total = (prompt_tokens or 0) + (completion_tokens or 0)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total,
    }


class OllamaScorer:
    def __init__(
        self,
        base_url: str = OLLAMA_BASE_URL,
        model_name: str = OLLAMA_MODEL,
        timeout: float = OLLAMA_TIMEOUT_SECONDS,
        supports_vision: bool = OLLAMA_SUPPORTS_VISION,
    ):
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name
        self.timeout = timeout
        self.supports_vision = supports_vision

    @property
    def available(self) -> bool:
        """Whether the daemon answers and holds the configured model.

        Checked once at startup so a missing model is a log line at boot rather
        than a failed submission later.
        """
        try:
            response = httpx.get(f"{self.base_url}/api/tags", timeout=5.0)
            response.raise_for_status()
            installed = {
                model.get("name", "") for model in response.json().get("models", [])
            }
        except Exception as e:
            logger.warning(f"Ollama not reachable at {self.base_url}: {e}")
            return False

        # Ollama reports "qwen2.5:7b-instruct"; a bare "qwen2.5" is the :latest tag.
        wanted = self.model_name if ":" in self.model_name else f"{self.model_name}:latest"
        if wanted not in installed:
            logger.warning(
                f"Ollama is up but {wanted} is not pulled. Run: ollama pull {self.model_name}"
            )
            return False
        return True

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict:
        ensure_vision_capable("ollama", self.supports_vision, task_image_url)

        user_message = {"role": "user", "content": build_user_prompt(task_prompt, task_type, essay_text)}
        if task_image_url:
            image_bytes, _mime_type = await fetch_task_image(task_image_url)
            user_message["images"] = [base64.b64encode(image_bytes).decode("ascii")]

        request = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": IELTS_SYSTEM_PROMPT},
                user_message,
            ],
            # Ollama constrains generation to this JSON Schema, the same way the
            # Gemini provider passes response_schema.
            "format": IELTSScoringResult.model_json_schema(),
            "stream": False,
            # Scoring must not drift between two runs of the same essay.
            "options": {"temperature": 0},
        }

        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}/api/chat", json=request)
                response.raise_for_status()
                payload = response.json()

            elapsed_ms = int((time.perf_counter() - started) * 1000)
            parsed_data = json.loads(payload["message"]["content"])
            return completed_result(
                scores=parsed_data.get("scores"),
                feedback=parsed_data.get("feedback"),
                raw_output=parsed_data,
                model_name=self.model_name,
                provider=PROVIDER,
                elapsed_ms=elapsed_ms,
                token_counts=token_counts(payload),
                descriptor=self.descriptor(),
            )
        except Exception as e:
            logger.error(f"Ollama scoring error: {e}")
            raise e

    def descriptor(self) -> dict:
        return {
            "modelName": self.model_name,
            "modelVersion": SCORER_REVISION,
            "provider": PROVIDER,
            "taskType": "both",
            # base_url stays out: it is where the model ran, not which grader it
            # is, and including it would split one grader per developer machine.
            "configuration": {
                **base_configuration(),
                "response_format": "json_schema",
                "response_schema": "IELTSScoringResult",
                "temperature": 0,
            },
        }
