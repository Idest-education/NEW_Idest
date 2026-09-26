import json
import pytest
from retry import (
    backoff_delay,
    is_retryable,
    next_delay,
    retry_after_seconds,
    status_code,
)

BASE = 2.0
CAP = 60.0


class ApiError(Exception):
    """Shaped like google.genai.errors.APIError: a .code and nested .details."""

    def __init__(self, code, details=None):
        super().__init__(f"{code} error")
        self.code = code
        self.details = details


class Response:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}


class TransportError(Exception):
    def __init__(self, response):
        super().__init__("transport error")
        self.response = response


def test_status_code_reads_sdk_and_transport_shapes():
    assert status_code(ApiError(429)) == 429
    assert status_code(TransportError(Response(503))) == 503
    assert status_code(RuntimeError("no status here")) is None


def test_rate_limit_is_retryable_and_bad_request_is_not():
    assert is_retryable(ApiError(429)) is True
    assert is_retryable(ApiError(503)) is True
    assert is_retryable(ApiError(400)) is False
    assert is_retryable(ApiError(403)) is False


def test_our_own_bugs_do_not_spend_another_call():
    assert is_retryable(TypeError("NoneType is not subscriptable")) is False
    assert is_retryable(AttributeError("no attribute 'text'")) is False


def test_a_truncated_json_body_is_worth_one_more_call():
    error = json.JSONDecodeError("Unterminated string", '{"scores":', 10)
    assert is_retryable(error) is True


def test_unclassified_errors_stay_retryable():
    assert is_retryable(RuntimeError("connection reset by peer")) is True


def test_retry_after_comes_from_gemini_retry_info():
    error = ApiError(
        429,
        details={
            "error": {
                "details": [
                    {"@type": "type.googleapis.com/google.rpc.QuotaFailure"},
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": "31s",
                    },
                ]
            }
        },
    )
    assert retry_after_seconds(error) == 31.0


def test_retry_after_falls_back_to_the_http_header():
    error = TransportError(Response(429, {"retry-after": "12"}))
    assert retry_after_seconds(error) == 12.0


def test_no_retry_advice_reads_as_none():
    assert retry_after_seconds(ApiError(500)) is None
    assert retry_after_seconds(TransportError(Response(429, {}))) is None


def test_backoff_grows_exponentially_and_stops_at_the_cap():
    assert backoff_delay(1, BASE, CAP, jitter=1.0) == 2.0
    assert backoff_delay(2, BASE, CAP, jitter=1.0) == 4.0
    assert backoff_delay(3, BASE, CAP, jitter=1.0) == 8.0
    assert backoff_delay(20, BASE, CAP, jitter=1.0) == CAP


def test_jitter_only_ever_shortens_the_wait():
    assert backoff_delay(3, BASE, CAP, jitter=0.0) == 4.0
    assert backoff_delay(3, BASE, CAP, jitter=0.5) == 6.0


def test_next_delay_honours_the_providers_own_number():
    error = ApiError(429, details={"retryDelay": "7s"})
    assert next_delay(1, error, base=BASE, cap=CAP) == 7.0


def test_next_delay_refuses_a_wait_longer_than_the_ceiling():
    error = ApiError(429, details={"retryDelay": "3600s"})
    assert next_delay(1, error, base=BASE, cap=CAP) is None


def test_next_delay_refuses_a_non_retryable_error():
    assert next_delay(1, ApiError(400), base=BASE, cap=CAP) is None


def test_next_delay_backs_off_when_the_provider_gives_no_advice():
    assert next_delay(2, ApiError(503), base=BASE, cap=CAP, jitter=1.0) == 4.0
