"""The two model calls extraction needs: read pages from images, and answer in JSON.

Kept apart from the grader stack on purpose: extraction output never becomes a
score, so it needs no ai_model_versions identity, cache or rotation. It reuses
the grader's keys and models.
"""

import base64
import json
import logging
from typing import Protocol

import httpx
from pydantic import BaseModel

from config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_THINKING_LEVEL,
    MIN_SECONDS_BETWEEN_CALLS,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_COMPATIBLE_TIMEOUT_SECONDS,
    OPENAI_MODEL,
)
from prompt import build_schema_instruction
from providers.openai_compatible import strip_code_fence
from rate_limit import RateLimiter

logger = logging.getLogger(__name__)

TRANSCRIBE_SYSTEM = """
You transcribe photos or scans of IELTS Writing essays, handwritten or printed.
Copy the student's words exactly as written: keep their spelling mistakes, grammar
errors and paragraph breaks, because the transcript will be graded. Never correct,
summarise or complete anything. Write [illegible] for words you cannot read.
Return one transcript per image, in the order the images are given. If the task
question itself is visible on a page, copy it into task_prompt, and leave it out
of the page transcript; otherwise leave task_prompt empty.
"""


class PageTranscript(BaseModel):
    pages: list[str]
    task_prompt: str = ""


Image = tuple[bytes, str]  # (bytes, mime type)


class ExtractionLLM(Protocol):
    name: str

    async def transcribe(self, images: list[Image]) -> PageTranscript: ...

    async def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> dict: ...


class GeminiExtractor:
    name = "gemini"

    def __init__(self, api_key: str = GEMINI_API_KEY, model: str = GEMINI_MODEL):
        from google import genai

        self.client = genai.Client(api_key=api_key)
        self.model = model

    async def _generate(self, system: str, contents, schema: type[BaseModel]) -> dict:
        from google.genai import types

        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,
                thinking_config=types.ThinkingConfig(thinking_level=GEMINI_THINKING_LEVEL)
                if GEMINI_THINKING_LEVEL
                else None,
            ),
        )
        return json.loads(response.text)

    async def transcribe(self, images: list[Image]) -> PageTranscript:
        from google.genai import types

        parts = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images]
        data = await self._generate(TRANSCRIBE_SYSTEM, [f"{len(images)} image(s) follow.", *parts], PageTranscript)
        return PageTranscript.model_validate(data)

    async def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> dict:
        return await self._generate(system, user, schema)


class OpenAIExtractor:
    name = "openai"

    def __init__(self, api_key: str = OPENAI_API_KEY, base_url: str = OPENAI_BASE_URL, model: str = OPENAI_MODEL):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def _chat(self, system: str, content, schema: type[BaseModel]) -> dict:
        async with httpx.AsyncClient(timeout=OPENAI_COMPATIBLE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json={
                    "model": self.model,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                    "response_format": {"type": "json_object"},
                },
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
        text = response.json()["choices"][0]["message"]["content"]
        return json.loads(strip_code_fence(text))

    async def transcribe(self, images: list[Image]) -> PageTranscript:
        content = [{"type": "text", "text": f"{len(images)} image(s) follow." + build_schema_instruction(PageTranscript.model_json_schema())}]
        for data, mime in images:
            encoded = base64.b64encode(data).decode("ascii")
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}})
        return PageTranscript.model_validate(await self._chat(TRANSCRIBE_SYSTEM, content, PageTranscript))

    async def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> dict:
        return await self._chat(system, user + build_schema_instruction(schema.model_json_schema()), schema)


class StubExtractor:
    """Development without keys: canned transcripts, and no JSON answers at all,
    so callers fall back to their heuristics."""

    name = "stub"

    async def transcribe(self, images: list[Image]) -> PageTranscript:
        text = (
            "This is a stub transcript because no vision model is configured. "
            "Many people believe that technology has improved our lives, while others disagree. "
            "In this essay I will discuss both views and give my own opinion."
        )
        return PageTranscript(pages=[text for _ in images])

    async def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> dict:
        raise NotImplementedError("No LLM configured for extraction")


class Throttled:
    """Holds calls apart like the grader's ThrottledScorer.
    shortcut: separate limiter from the grader's, so both together can reach 2x the floor;
    share one limiter process-wide if a provider's per-minute cap starts returning 429s."""

    def __init__(self, inner: ExtractionLLM, limiter: RateLimiter):
        self.inner = inner
        self.limiter = limiter
        self.name = inner.name

    async def transcribe(self, images: list[Image]) -> PageTranscript:
        await self.limiter.acquire()
        return await self.inner.transcribe(images)

    async def complete_json(self, system: str, user: str, schema: type[BaseModel]) -> dict:
        await self.limiter.acquire()
        return await self.inner.complete_json(system, user, schema)


def build_extractor() -> ExtractionLLM:
    """Gemini when keyed (natively multimodal), else OpenAI, else the stub."""
    if GEMINI_API_KEY:
        inner: ExtractionLLM = GeminiExtractor()
    elif OPENAI_API_KEY:
        inner = OpenAIExtractor()
    else:
        logger.warning("No GEMINI_API_KEY or OPENAI_API_KEY; extraction returns stub transcripts")
        return StubExtractor()
    logger.info(f"Extraction uses {inner.name}")
    return Throttled(inner, RateLimiter(MIN_SECONDS_BETWEEN_CALLS))
