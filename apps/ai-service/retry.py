"""Decides whether a failed scoring call is worth another provider request.

The free-tier failure mode this guards against: a rate-limited call retried
immediately spends another unit of quota, fails the same way, and reports the
submission as failed. Every retry here either waits out the limit or does not
happen at all.
"""

import json
import logging
import re

logger = logging.getLogger(__name__)

# Worth another call after a wait: the limit resets, the outage clears.
RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}

# A second identical call fails identically: bad request, bad key, wrong model.
# Retrying these is what silently drains a quota.
NON_RETRYABLE_STATUS = {400, 401, 403, 404, 405, 413, 422}

# Raised by our own code, not by the provider. The essay is not the problem and
# the next attempt hits the same line.
PROGRAMMING_ERRORS = (TypeError, AttributeError, KeyError, NameError, IndexError)

# Both spellings a Gemini 429 uses for its own advice: the RetryInfo detail
# ("retryDelay": "31s") and the HTTP header (Retry-After: 31).
_DURATION = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*s?\s*$")


def status_code(exc) -> int | None:
    """HTTP status behind an exception, across SDK and transport error shapes."""
    for attribute in ("code", "status_code", "status"):
        value = getattr(exc, attribute, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def _parse_duration(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value) if value >= 0 else None
    if not isinstance(value, str):
        return None
    match = _DURATION.match(value)
    return float(match.group(1)) if match else None


def _walk_details(details):
    """Yields every retryDelay found in an APIError's nested details."""
    if isinstance(details, dict):
        for key, value in details.items():
            if key in ("retryDelay", "retry_delay"):
                yield value
            else:
                yield from _walk_details(value)
    elif isinstance(details, (list, tuple)):
        for item in details:
            yield from _walk_details(item)


def retry_after_seconds(exc) -> float | None:
    """The delay the provider asked for, when it sent one."""
    for candidate in _walk_details(getattr(exc, "details", None)):
        seconds = _parse_duration(candidate)
        if seconds is not None:
            return seconds

    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is not None:
        try:
            header = headers.get("retry-after") or headers.get("Retry-After")
        except AttributeError:
            header = None
        seconds = _parse_duration(header)
        if seconds is not None:
            return seconds
    return None


def is_retryable(exc) -> bool:
    status = status_code(exc)
    if status is not None:
        if status in NON_RETRYABLE_STATUS:
            return False
        if status in RETRYABLE_STATUS:
            return True
        # Any other client error is a request we built wrong.
        return not 400 <= status < 500

    # A truncated or malformed JSON body can come back well-formed next time,
    # so this is checked before its ValueError base class.
    if isinstance(exc, json.JSONDecodeError):
        return True
    if isinstance(exc, PROGRAMMING_ERRORS):
        return False
    if isinstance(exc, ValueError):
        return False
    # Transport faults arrive as a wide spread of SDK-specific types, so an
    # unclassified error is treated as transient. Backoff makes that cheap.
    return True


def backoff_delay(attempt: int, base: float, cap: float, jitter: float = 1.0) -> float:
    """Full-jitter exponential backoff for attempt number `attempt` (1-based)."""
    window = min(cap, base * 2 ** max(0, attempt - 1))
    return window * (0.5 + 0.5 * min(max(jitter, 0.0), 1.0))


def next_delay(
    attempt: int,
    exc: Exception,
    base: float,
    cap: float,
    jitter: float = 1.0,
) -> float | None:
    """Seconds to wait before attempt `attempt + 1`, or None to stop trying.

    None means one of two things, and both are better than another call: the
    error will repeat, or the provider asked for a longer wait than a worker
    should hold a message for. Stopping leaves the submission retryable.
    """
    if not is_retryable(exc):
        logger.info(f"Not retrying {type(exc).__name__} (status {status_code(exc)})")
        return None

    requested = retry_after_seconds(exc)
    if requested is not None:
        if requested > cap:
            logger.warning(
                f"Provider asked for {requested}s, above the {cap}s ceiling; giving up"
            )
            return None
        return requested

    return backoff_delay(attempt, base, cap, jitter)
