"""Gemini grader. The paid-tier provider, and the one the benchmark uses."""

import json
import logging
import time

from config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_THINKING_LEVEL, SCORER_REVISION
from prompt import IELTS_SYSTEM_PROMPT, build_user_prompt
from providers.base import NO_TOKEN_COUNTS, base_configuration, completed_result
from schemas import IELTSScoringResult

logger = logging.getLogger(__name__)

PROVIDER = "google"


def token_counts(response) -> dict:
    """Token usage from a Gemini response, or nulls when the SDK omits it."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return dict(NO_TOKEN_COUNTS)
    return {
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "completion_tokens": getattr(usage, "candidates_token_count", None),
        "total_tokens": getattr(usage, "total_token_count", None),
    }


class GeminiScorer:
    def __init__(
        self,
        api_key: str = GEMINI_API_KEY,
        model_name: str = GEMINI_MODEL,
        thinking_level: str = GEMINI_THINKING_LEVEL,
    ):
        self.api_key = api_key
        self.model_name = model_name
        self.thinking_level = thinking_level
        self.client = self._build_client()

    def _thinking_config(self):
        """The reasoning budget, or None to leave the model's default alone.

        Empty is an escape hatch: models that predate thinking_level reject it
        with a 400, which retry.py treats as non-retryable, so an unsupported
        level would fail every submission rather than degrade quietly.
        """
        if not self.thinking_level:
            return None
        from google.genai import types

        return types.ThinkingConfig(thinking_level=self.thinking_level)

    def _build_client(self):
        if not self.api_key:
            return None
        try:
            from google import genai
            return genai.Client(api_key=self.api_key)
        except Exception as e:
            logger.warning(f"Could not initialize Google GenAI SDK: {e}")
            return None

    @property
    def available(self) -> bool:
        return self.client is not None

    async def score_essay(self, task_prompt: str, task_type: str, essay_text: str) -> dict:
        from google.genai import types

        prompt = build_user_prompt(task_prompt, task_type, essay_text)
        started = time.perf_counter()
        try:
            # The SDK's async surface. The sync one blocks the event loop for the
            # whole call, which stalls the worker's own timers and the broker
            # connection's heartbeat for as long as Gemini takes to answer.
            response = await self.client.aio.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=IELTS_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=IELTSScoringResult,
                    thinking_config=self._thinking_config(),
                ),
            )
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            parsed_data = json.loads(response.text)
            return completed_result(
                scores=parsed_data.get("scores"),
                feedback=parsed_data.get("feedback"),
                raw_output=parsed_data,
                model_name=self.model_name,
                provider=PROVIDER,
                elapsed_ms=elapsed_ms,
                token_counts=token_counts(response),
                descriptor=self.descriptor(),
            )
        except Exception as e:
            logger.error(f"Gemini API scoring error: {e}")
            raise e

    def descriptor(self) -> dict:
        """Identifies the grader that produced a result, for ai_model_versions."""
        return {
            "modelName": self.model_name,
            "modelVersion": SCORER_REVISION,
            "provider": PROVIDER,
            "taskType": "both",
            # thinking_level is part of grader identity: it changes how much the
            # model reasons, so results at two levels are not comparable.
            "configuration": {
                **base_configuration(),
                "response_mime_type": "application/json",
                "response_schema": "IELTSScoringResult",
                "thinking_level": self.thinking_level or None,
            },
        }
