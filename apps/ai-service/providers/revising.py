"""A second reading by the same grader for drafts with an extreme overall band.

Graders drift toward the middle of the scale: a strong essay held at 7 for a few
slips, a weak one lifted to 5 for its length. Bands outside REVISE_OUTSIDE are
where that bias shows, so only those drafts are sent back, with the draft
attached, for the grader to moderate against the same descriptors.

The same grader revises, so one essay still has one model behind it. The draft
is kept in raw_output and processing_metadata, so the analysis can measure how
often and how far the second reading moves a band.
"""

import logging

from prompt import REVISE_OUTSIDE

logger = logging.getLogger(__name__)

TOKEN_KEYS = ("prompt_tokens", "completion_tokens", "total_tokens")


def needs_revision(overall: float) -> bool:
    low, high = REVISE_OUTSIDE
    return overall < low or overall > high


class RevisingScorer:
    def __init__(self, inner):
        self.inner = inner

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict:
        draft = await self.inner.score_essay(task_prompt, task_type, essay_text, task_image_url)
        if not needs_revision(draft["scores"]["overall"]):
            return {**draft, "processing_metadata": {**draft["processing_metadata"], "revised": False}}

        logger.info(f"Draft overall {draft['scores']['overall']} is outside {REVISE_OUTSIDE}; revising")
        # A failed revision raises like a failed grading: the job is retried
        # whole, rather than an unmoderated extreme band being stored as final.
        revised = await self.inner.score_essay(
            task_prompt, task_type, essay_text, task_image_url, review_of=draft["raw_output"]
        )
        first, second = draft["processing_metadata"], revised["processing_metadata"]
        return {
            **revised,
            "raw_output": {"draft": draft["raw_output"], "revised": revised["raw_output"]},
            "processing_metadata": {
                **second,
                "elapsed_ms": first["elapsed_ms"] + second["elapsed_ms"],
                **{k: _sum(first.get(k), second.get(k)) for k in TOKEN_KEYS},
                "revised": True,
                "draft_scores": draft["scores"],
            },
        }

    def descriptor(self) -> dict:
        return self.inner.descriptor()

    @property
    def supports_vision(self) -> bool:
        return getattr(self.inner, "supports_vision", False)


def _sum(a, b):
    return None if a is None and b is None else (a or 0) + (b or 0)
