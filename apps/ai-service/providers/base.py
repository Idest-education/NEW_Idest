"""What every scoring provider must look like to the worker."""

from typing import Protocol, runtime_checkable

from config import MAX_RETRIES
from prompt import PROMPT_SHA256

# Every provider reports exactly these keys, so a result is comparable across
# providers and the server sees one shape. Asserted in the provider tests.
METADATA_KEYS = (
    "model_name",
    "provider",
    "elapsed_ms",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
)

NO_TOKEN_COUNTS = {
    "prompt_tokens": None,
    "completion_tokens": None,
    "total_tokens": None,
}


@runtime_checkable
class Scorer(Protocol):
    """A grader the worker can hand an essay to.

    `descriptor` must identify the grader well enough that two different
    graders never share one ai_model_versions row — that is what lets the
    analysis compare the LLM against the teacher and against CatBoost.
    """

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict: ...

    def descriptor(self) -> dict: ...


def ensure_vision_capable(provider_label: str, supports_vision: bool, task_image_url: str | None) -> None:
    """Refuses a Task 1 image a grader cannot see, rather than scoring blind.

    Rule 6 (CP over AP): a provider that silently ignored the chart would grade
    task_response against nothing and call it a result, not fail to produce
    one. Raised as a ValueError, which retry.py treats as non-retryable — this
    is a configuration problem, not a transient one, so the submission fails
    fast and stays retryable once a vision-capable grader is configured.
    """
    if task_image_url and not supports_vision:
        raise ValueError(
            f"{provider_label} has no vision support configured; cannot grade a Task 1 image"
        )


def base_configuration() -> dict:
    """The part of `descriptor()["configuration"]` every provider shares."""
    return {
        "system_prompt_sha256": PROMPT_SHA256,
        "max_retries": MAX_RETRIES,
    }


def completed_result(
    scores: dict,
    feedback: dict,
    raw_output: dict,
    model_name: str,
    provider: str,
    elapsed_ms: int,
    token_counts: dict | None = None,
    descriptor: dict | None = None,
) -> dict:
    """A finished score, carrying the identity of the grader that produced it.

    `model_descriptor` rides along with the result rather than being fetched
    separately afterwards. When several graders share one worker, asking the
    scorer "who are you?" after the fact can name the wrong one, and rule 3
    says every AI result records its own ai_model_versions reference.
    """
    result = {
        "status": "completed",
        "scores": scores,
        "feedback": feedback,
        "raw_output": raw_output,
        "processing_metadata": {
            "model_name": model_name,
            "provider": provider,
            "elapsed_ms": elapsed_ms,
            **(token_counts or NO_TOKEN_COUNTS),
        },
    }
    if descriptor is not None:
        result["model_descriptor"] = descriptor
    return result
