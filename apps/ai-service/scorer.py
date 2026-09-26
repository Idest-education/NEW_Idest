"""Chooses the grader the worker runs against, and the layers around it.

The default is a rotation over three graders from three providers: GPT, Gemini
and Qwen. One essay gets one score from one of them. The point is quota — three
free tiers instead of one — and the side benefit is that the benchmark ends up
holding results from three models instead of one.

The layers, outermost first:

    RotatingScorer        pick the next grader that is not rate-limited
      CachedScorer        already scored this essay with this grader? serve it
        ThrottledScorer   hold the call until this provider's rate floor allows it
          provider        GPT / Gemini / Qwen / Ollama / stub

The cache sits under the rotation, once per grader, because a cache key includes
the grader's identity. The rotation still asks every cache first, so an essay
that any grader already scored costs nothing and does not advance the rotation.
A single-provider setup gets the same stack without the rotation layer.
"""

import logging

from cache import CachedScorer, ScoringCache
from config import (
    GEMINI_API_KEY,
    LLM_PROVIDER,
    MIN_SECONDS_BETWEEN_CALLS,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_COMPATIBLE_TIMEOUT_SECONDS,
    OPENAI_MODEL,
    CN_API_KEY,
    CN_BASE_URL,
    CN_HOST,
    CN_MODEL,
    CN_STRUCTURED_MODE,
    ROTATION_COOLDOWN_SECONDS,
    SCORING_CACHE_DIR,
    SCORING_CACHE_ENABLED,
)
from providers import (
    GeminiScorer,
    OllamaScorer,
    OpenAICompatibleScorer,
    RotatingScorer,
    Scorer,
    StubScorer,
    ThrottledScorer,
)
from providers.hosts import resolve as resolve_host
from rate_limit import RateLimiter

logger = logging.getLogger(__name__)

ROTATE = "rotate"
OPENAI = "openai"
GEMINI = "gemini"
# The third slot. Which host serves it is CN_HOST; the descriptor records that
# host, because the same weights served two ways are two graders.
CN = "cn"
OLLAMA = "ollama"
STUB = "stub"
PROVIDERS = (ROTATE, OPENAI, GEMINI, CN, OLLAMA, STUB)

# The graders the rotation draws from, in the order it first tries them.
ROTATION = (OPENAI, GEMINI, CN)

# Providers billed or quota-limited per call. Only these need the rate floor;
# a local model and the stub cost nothing and are already serialised by
# prefetch_count=1 on the queue. Each gets its own limiter, so rotating over
# three of them gives three times the throughput of one.
METERED = (OPENAI, GEMINI, CN)


def _build_one(name: str) -> Scorer | None:
    """One bare provider, or None when it is not configured or not reachable."""
    if name == OPENAI:
        scorer = OpenAICompatibleScorer(
            base_url=OPENAI_BASE_URL,
            api_key=OPENAI_API_KEY,
            model_name=OPENAI_MODEL,
            provider_name="openai",
            timeout=OPENAI_COMPATIBLE_TIMEOUT_SECONDS,
        )
    elif name == CN:
        resolved = resolve_host(
            CN_HOST,
            api_key=CN_API_KEY,
            base_url=CN_BASE_URL,
            model=CN_MODEL,
            structured_mode=CN_STRUCTURED_MODE,
        )
        if resolved is None:
            logger.warning(f"Unknown CN_HOST '{CN_HOST}'; leaving the third grader out")
            return None
        host, api_key, base_url, model, structured_mode = resolved
        if api_key and not base_url:
            # dashscope and custom have no endpoint default, so say which one is
            # missing rather than letting a blank base_url read as "no key".
            logger.warning(
                f"A key for host '{host.label}' is set but no endpoint is. "
                f"Set CN_BASE_URL (host '{host.label}' has no default)."
            )
        scorer = OpenAICompatibleScorer(
            base_url=base_url,
            api_key=api_key,
            model_name=model,
            provider_name=host.label,
            structured_mode=structured_mode,
            timeout=OPENAI_COMPATIBLE_TIMEOUT_SECONDS,
        )
    elif name == GEMINI:
        # The key is passed in rather than read from config inside the provider,
        # so this module is the single source of truth for which graders are
        # configured. Otherwise _has_key and the provider can disagree.
        scorer = GeminiScorer(api_key=GEMINI_API_KEY)
    elif name == OLLAMA:
        scorer = OllamaScorer()
    elif name == STUB:
        return StubScorer()
    else:
        return None

    if not scorer.available:
        return None
    return scorer


def _wrap(scorer: Scorer, name: str, cache_enabled: bool, cache_dir: str, min_seconds: float) -> Scorer:
    """Puts the throttle and then the cache around one grader."""
    if name in METERED and min_seconds > 0:
        scorer = ThrottledScorer(scorer, RateLimiter(min_seconds))
    if cache_enabled:
        scorer = CachedScorer(scorer, ScoringCache(cache_dir, enabled=True))
    return scorer


def _resolve_name(requested: str) -> str:
    """The provider to build, from LLM_PROVIDER or from what is configured."""
    if requested in PROVIDERS:
        return requested
    if requested:
        logger.warning(
            f"Unknown LLM_PROVIDER '{requested}'; expected one of {', '.join(PROVIDERS)}"
        )
    # Rotate as soon as more than one hosted grader has a key, so adding a key
    # is all it takes to widen the rotation.
    configured = [name for name in ROTATION if _has_key(name)]
    if len(configured) > 1:
        return ROTATE
    if configured:
        return configured[0]
    return STUB


def _has_key(name: str) -> bool:
    """Whether a rotation member is configured enough to be worth building."""
    if name == CN:
        # The third slot needs both a key and an endpoint, and its key may live
        # in the host's own env var rather than CN_API_KEY.
        resolved = resolve_host(
            CN_HOST,
            api_key=CN_API_KEY,
            base_url=CN_BASE_URL,
            model=CN_MODEL,
            structured_mode=CN_STRUCTURED_MODE,
        )
        if resolved is None:
            return False
        _, api_key, base_url, model, _ = resolved
        return bool(api_key and base_url and model)
    return bool({OPENAI: OPENAI_API_KEY, GEMINI: GEMINI_API_KEY}.get(name))


def build_provider(requested: str = LLM_PROVIDER) -> tuple[Scorer, str]:
    """The bare provider and the name it was actually built as.

    A provider asked for by name but not usable falls back to the stub rather
    than failing at boot, which is how a missing GEMINI_API_KEY behaved before.
    The warning is the signal that scores are no longer real.
    """
    name = _resolve_name(requested)
    if name == ROTATE:
        return StubScorer(), STUB  # the rotation is assembled in build_scorer

    scorer = _build_one(name)
    if scorer is not None and name != STUB:
        logger.info(f"Scoring with {name} model {getattr(scorer, 'model_name', name)}")
        return scorer, name
    if name != STUB:
        logger.warning(f"{name} is configured but unavailable; falling back to stub scores")
    else:
        logger.warning("No scoring provider configured; returning stub scores")
    return StubScorer(), STUB


def build_scorer(
    requested: str = LLM_PROVIDER,
    cache_enabled: bool = SCORING_CACHE_ENABLED,
    cache_dir: str = SCORING_CACHE_DIR,
    min_seconds_between_calls: float = MIN_SECONDS_BETWEEN_CALLS,
    cooldown_seconds: float = ROTATION_COOLDOWN_SECONDS,
) -> Scorer:
    """The scorer the worker should use, with its cache, throttle and rotation."""
    name = _resolve_name(requested)

    if name == ROTATE:
        candidates = []
        for member in ROTATION:
            built = _build_one(member)
            if built is None:
                logger.info(f"{member} is not configured; leaving it out of the rotation")
                continue
            candidates.append(
                _wrap(built, member, cache_enabled, cache_dir, min_seconds_between_calls)
            )
            label = built.descriptor()["provider"]
            logger.info(f"Rotation includes {label} model {built.model_name}")

        if not candidates:
            logger.warning("Rotation has no configured graders; returning stub scores")
            return _wrap(StubScorer(), STUB, cache_enabled, cache_dir, min_seconds_between_calls)
        if len(candidates) == 1:
            return candidates[0]
        return RotatingScorer(candidates, cooldown_seconds=cooldown_seconds)

    scorer, built_as = build_provider(name)
    return _wrap(scorer, built_as, cache_enabled, cache_dir, min_seconds_between_calls)
