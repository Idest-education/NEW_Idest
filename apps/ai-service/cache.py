"""A content-addressed cache over a scorer.

Development and demos rescore the same seeded essays again and again. Each of
those is a paid call that returns what the last one returned. The key is the
essay, the prompt, and the grader's full identity, so a cached result is one the
same grader already produced from the same input.

Only completed results are stored. A failed result must stay failed so the
submission stays retryable, and a cache miss is always safe.
"""

import hashlib
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Bumped when the stored envelope changes shape, so old files are ignored
# instead of being fed to a reader that expects new keys.
CACHE_FORMAT = "v1"


def cache_key(
    descriptor: dict,
    task_prompt: str,
    task_type: str,
    essay_text: str,
    task_image_url: str | None = None,
) -> str:
    """A digest over the input and the grader that would score it.

    The whole descriptor goes in, so a prompt edit, a model swap, or a
    SCORER_REVISION bump all produce a different key. A stale result can never
    be served as a newer grader's work. task_image_url is in too: a teacher
    replacing a Task 1 chart must not serve the old chart's cached result.
    """
    material = json.dumps(
        {
            "format": CACHE_FORMAT,
            "descriptor": descriptor,
            "task_type": task_type,
            "task_prompt": task_prompt,
            "essay_text": essay_text,
            "task_image_url": task_image_url,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


class ScoringCache:
    """One JSON file per key, so it survives a worker restart."""

    def __init__(self, directory: str | Path, enabled: bool = True):
        self.directory = Path(directory)
        self.enabled = enabled

    def _path(self, key: str) -> Path:
        return self.directory / f"{key}.json"

    def get(self, key: str) -> dict | None:
        if not self.enabled:
            return None
        path = self._path(key)
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError) as e:
            # A damaged entry is a miss, never an error. Scoring again is correct.
            logger.warning(f"Ignoring unreadable cache entry {path.name}: {e}")
            return None

        if stored.get("format") != CACHE_FORMAT or "result" not in stored:
            logger.warning(f"Ignoring cache entry {path.name} from an older format")
            return None
        return stored["result"]

    def put(self, key: str, result: dict) -> bool:
        """Stores a completed result. Returns whether it was stored."""
        if not self.enabled or result.get("status") != "completed":
            return False
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            # Written beside the target, then moved, so a crash mid-write cannot
            # leave a half-written entry that a later read would have to guess at.
            temporary = self._path(key).with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps({"format": CACHE_FORMAT, "result": result}, ensure_ascii=False),
                encoding="utf-8",
            )
            temporary.replace(self._path(key))
            return True
        except OSError as e:
            logger.warning(f"Could not write cache entry: {e}")
            return False


class CachedScorer:
    """Wraps a scorer and answers from disk when the same work was done before.

    A served result is marked `cache_hit` in its processing metadata, with the
    original latency and token counts left untouched, so the analysis can drop
    cached rows from any timing or cost measurement.
    """

    def __init__(self, inner, cache: ScoringCache):
        self.inner = inner
        self.cache = cache

    def peek(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict | None:
        """The stored result for this essay, without calling the provider.

        Lets a caller above this layer — the rotation — find work already done
        before it spends a grader's quota on it.
        """
        key = cache_key(self.inner.descriptor(), task_prompt, task_type, essay_text, task_image_url)
        hit = self.cache.get(key)
        if hit is None:
            return None
        logger.info(f"Serving a cached scoring result ({key[:12]})")
        return {**hit, "processing_metadata": {**hit.get("processing_metadata", {}), "cache_hit": True}}

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict:
        hit = self.peek(task_prompt, task_type, essay_text, task_image_url)
        if hit is not None:
            return hit

        key = cache_key(self.inner.descriptor(), task_prompt, task_type, essay_text, task_image_url)
        result = await self.inner.score_essay(task_prompt, task_type, essay_text, task_image_url)
        stored = {**result, "processing_metadata": {**result.get("processing_metadata", {})}}
        stored["processing_metadata"]["cache_hit"] = False
        self.cache.put(key, stored)
        return stored

    def descriptor(self) -> dict:
        return self.inner.descriptor()

    @property
    def supports_vision(self) -> bool:
        return getattr(self.inner, "supports_vision", False)
