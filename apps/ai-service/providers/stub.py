"""Fixed scores, no provider call. What runs when no API key is configured.

The descriptor and metadata deliberately keep the historical `google-stub`
provider name: dev databases already hold rows under it, and renaming would
split one grader's history across two ai_model_versions rows.
"""

from config import SCORER_REVISION
from providers.base import base_configuration, completed_result

PROVIDER = "google-stub"
MODEL_NAME = "stub-gemini-model"


class StubScorer:
    # Fabricates fixed scores regardless of input, so an image is never a
    # reason to fail locally — it just goes unused, like the essay text does.
    supports_vision = True

    async def score_essay(
        self, task_prompt: str, task_type: str, essay_text: str, task_image_url: str | None = None
    ) -> dict:
        return completed_result(
            scores={
                "task_response": 6.5,
                "coherence_cohesion": 7.0,
                "lexical_resource": 6.5,
                "grammatical_range_accuracy": 6.0,
                "overall": 6.5,
            },
            feedback={
                "summary": "The essay addresses the task prompt well with clear overall structure.",
                "strengths": ["Clear position presented", "Logical paragraph organization"],
                "improvements": ["Enhance vocabulary precision", "Vary sentence structures"],
                "sentence_feedback": [],
            },
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
