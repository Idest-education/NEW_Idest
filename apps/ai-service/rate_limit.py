"""A floor on how often the worker may call the scoring provider."""

import asyncio
import logging
import time

logger = logging.getLogger(__name__)


class RateLimiter:
    """Spaces calls at least `min_interval` seconds apart.

    prefetch_count=1 already stops the worker running two jobs at once, but it
    does not stop a run of fast responses from crossing a per-minute cap. This
    does, and it counts retries as calls, because the provider does too.

    `clock` and `sleep` are injected so tests do not spend real seconds.
    """

    def __init__(self, min_interval: float, clock=time.monotonic, sleep=asyncio.sleep):
        self.min_interval = max(0.0, min_interval)
        self._clock = clock
        self._sleep = sleep
        self._next_allowed: float | None = None

    async def acquire(self) -> float:
        """Waits until the next call is allowed. Returns seconds actually waited."""
        if self.min_interval == 0.0:
            return 0.0

        now = self._clock()
        waited = 0.0
        if self._next_allowed is not None and now < self._next_allowed:
            waited = self._next_allowed - now
            logger.debug(f"Rate limiter holding the next call for {waited:.2f}s")
            await self._sleep(waited)
            now = max(self._clock(), self._next_allowed)

        self._next_allowed = now + self.min_interval
        return waited
