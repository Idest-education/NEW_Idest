"""Fixed scores, no provider call. What runs when no API key is configured.

The descriptor and metadata deliberately keep the historical `google-stub`
provider name: dev databases already hold rows under it, and renaming would
split one grader's history across two ai_model_versions rows.
"""

from config import SCORER_REVISION
from providers.base import base_configuration, completed_result
from schemas import to_result

PROVIDER = "google-stub"
MODEL_NAME = "stub-gemini-model"


def _criterion(band: float, comment: str) -> dict:
    return {"evidence": [], "reasoning": "Stub grader: fixed band, essay not read.", "band": band, "comment": comment}


STUB_REPLY = {
    "task_response": _criterion(6.5, "Addresses the task; extend each main idea with a specific example."),
    "coherence_cohesion": _criterion(7.0, "Clear paragraphing; vary linking words instead of repeating them."),
    "lexical_resource": _criterion(6.5, "Adequate range; use more precise topic vocabulary."),
    "grammatical_range_accuracy": _criterion(6.0, "Mix of structures; reduce errors in complex sentences."),
    "sentence_feedback": [],
    "comment": "The essay addresses the task prompt well with clear overall structure.",
}


class StubScorer:
    # Fabricates fixed scores regardless of input, so an image is never a
    # reason to fail locally — it just goes unused, like the essay text does.
    supports_vision = True

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict:
        scores, feedback = to_result(STUB_REPLY, essay_text)
        return completed_result(
            scores=scores,
            feedback=feedback,
            raw_output={"stub": True},
            model_name=MODEL_NAME,
            provider=PROVIDER,
            elapsed_ms=0,
            descriptor=self.descriptor(),
        )

    def descriptor(self) -> dict:
        return {
            "modelName": MODEL_NAME,
            "modelVersion": SCORER_REVISION,
            "provider": PROVIDER,
            "taskType": "both",
            "configuration": {
                **base_configuration(),
                "response_mime_type": "application/json",
                "response_schema": "IELTSScoringResult",
            },
        }
