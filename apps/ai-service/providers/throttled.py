"""Spaces out the calls that actually reach a provider.

This sits below the cache on purpose. A cached result costs no quota, so it must
not wait for a rate limit it is not going to consume — wrapping the other way
round would make a demo of twenty already-scored essays crawl.
"""

import logging

logger = logging.getLogger(__name__)


class ThrottledScorer:
    def __init__(self, inner, limiter):
        self.inner = inner
        self.limiter = limiter

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict:
        await self.limiter.acquire()
        return await self.inner.score_essay(task_prompt, task_type, essay_text, task_image_url)

    def descriptor(self) -> dict:
        return self.inner.descriptor()

    @property
    def supports_vision(self) -> bool:
        return getattr(self.inner, "supports_vision", False)
