"""Spreads scoring across several graders, one grader per essay.

The reason this exists is quota: three providers' free tiers are three times one
provider's free tier. Each essay goes to the next grader in the rotation, so no
single per-minute or per-day cap absorbs the whole load.

What it is not: an ensemble. One essay gets one score from one model, which
keeps the teacher's review unchanged — rule 1 still has exactly one preliminary
assessment to approve. Which model graded which essay is recorded per result,
so the analysis can still compare graders over the dataset. It compares them on
different essays, though, so the comparison is unpaired.
"""

import json
import logging
import time

from retry import PROGRAMMING_ERRORS, retry_after_seconds, status_code

logger = logging.getLogger(__name__)


def _is_our_bug(exc: Exception) -> bool:
    """Errors another provider would raise identically, so rotating wastes calls."""
    if isinstance(exc, PROGRAMMING_ERRORS):
        return True
    # A ValueError that is not a JSON decode failure came from our own argument
    # checking, not from the endpoint.
    return isinstance(exc, ValueError) and status_code(exc) is None and not _is_bad_json(exc)


def _is_bad_json(exc: Exception) -> bool:
    return isinstance(exc, json.JSONDecodeError)


class RotatingScorer:
    """Round-robin over graders, skipping the ones currently rate-limited."""

    def __init__(self, candidates, cooldown_seconds: float, clock=None):
        if not candidates:
            raise ValueError("RotatingScorer needs at least one candidate")
        self.candidates = list(candidates)
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock or time.monotonic
        self._cursor = 0
        self._cooling_until: dict[int, float] = {}
        self._last_attempted: int | None = None

    def _label(self, index: int) -> str:
        return self.candidates[index].descriptor().get("provider", f"candidate-{index}")

    def _is_cooling(self, index: int) -> bool:
        deadline = self._cooling_until.get(index)
        if deadline is None:
            return False
        if self._clock() >= deadline:
            del self._cooling_until[index]
            logger.info(f"{self._label(index)} is out of cooldown")
            return False
        return True

    def _cool_down(self, index: int, exc: Exception) -> None:
        """Takes a grader out of the rotation for as long as it asked for."""
        requested = retry_after_seconds(exc)
        seconds = requested if requested is not None else self.cooldown_seconds
        self._cooling_until[index] = self._clock() + seconds
        logger.warning(f"{self._label(index)} out of rotation for {seconds:.0f}s: {exc}")

    def _rotation_order(self) -> list[int]:
        count = len(self.candidates)
        return [(self._cursor + offset) % count for offset in range(count)]

    def _cached_elsewhere(self, task_prompt: str, task_type: str, essay_text: str):
        """A result any grader already produced for this exact essay.

        Checked before rotating: the rotation exists to spend quota evenly, and
        a stored result spends none. Without this, re-scoring an essay would
        rotate to a different grader, miss that grader's cache, and pay for work
        already done.
        """
        for candidate in self.candidates:
            peek = getattr(candidate, "peek", None)
            if peek is None:
                continue
            hit = peek(task_prompt, task_type, essay_text)
            if hit is not None:
                return hit
        return None

    async def score_essay(self, task_prompt: str, task_type: str, essay_text: str) -> dict:
        hit = self._cached_elsewhere(task_prompt, task_type, essay_text)
        if hit is not None:
            return hit

        last_error: Exception | None = None
        attempted = 0

        for index in self._rotation_order():
            if self._is_cooling(index):
                continue

            candidate = self.candidates[index]
            self._last_attempted = index
            self._cursor = (index + 1) % len(self.candidates)
            attempted += 1

            try:
                return await candidate.score_essay(task_prompt, task_type, essay_text)
            except Exception as exc:
                if _is_our_bug(exc):
                    # Every other grader fails on this too. Do not spend them.
                    raise
                last_error = exc
                self._cool_down(index, exc)

        if last_error is None:
            # Everything was already cooling down when the essay arrived.
            raise RuntimeError(
                f"All {len(self.candidates)} graders are rate-limited; nothing was called"
            )
        logger.error(f"All {attempted} available graders failed; last error: {last_error}")
        raise last_error

    def descriptor(self) -> dict:
        """The grader that last ran, for a result that carries none of its own.

        A completed result carries its own `model_descriptor`, so this is only
        consulted for failures. Naming the grader that actually failed is more
        useful than naming a fixed one.
        """
        index = self._last_attempted if self._last_attempted is not None else 0
        return self.candidates[index].descriptor()
