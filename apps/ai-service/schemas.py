import math
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

CRITERIA = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")
Criterion = Literal["task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"]


class CriterionAssessment(BaseModel):
    # Field order is generation order: the model quotes and reasons before it
    # commits to a band, so the band follows from the evidence, not the reverse.
    evidence: List[str]
    reasoning: str
    band: float = Field(ge=0, le=9)
    comment: str

    @field_validator("band")
    @classmethod
    def half_band(cls, value: float) -> float:
        if value * 2 != int(value * 2):
            raise ValueError(f"band {value} is not on a 0.5 step")
        return value


class SentenceFeedback(BaseModel):
    original: str
    explanation: str
    suggestion: str
    category: Criterion


class IELTSScoringResult(BaseModel):
    """What the model is asked to return. Overall is not in it: code computes that."""

    # Language criteria first, Task Response last: the whole-essay impression
    # forms on content, and grading it first lets that one band leak into the rest.
    grammatical_range_accuracy: CriterionAssessment
    lexical_resource: CriterionAssessment
    coherence_cohesion: CriterionAssessment
    task_response: CriterionAssessment
    sentence_feedback: List[SentenceFeedback]
    comment: str


def overall_band(bands: List[float]) -> float:
    """IELTS rule: mean of the four, .25 rounds up to .5 and .75 up to the next band."""
    return math.floor(sum(bands) / len(bands) * 2 + 0.5) / 2


def to_result(parsed: dict, essay_text: str) -> tuple[dict, dict]:
    """Validates a model reply and turns it into the stored scores and feedback.

    Raises pydantic.ValidationError on a bad shape or an off-step band, which the
    retry layer treats like malformed JSON. Sentence comments quoting text that
    is not in the essay are dropped rather than shown as if the student wrote it.
    """
    result = IELTSScoringResult.model_validate(parsed)
    assessments = {key: getattr(result, key) for key in CRITERIA}
    scores = {key: a.band for key, a in assessments.items()}
    scores["overall"] = overall_band(list(scores.values()))
    feedback = {
        "comment": result.comment,
        "criteria": {
            key: {"comment": a.comment, "evidence": a.evidence, "reasoning": a.reasoning}
            for key, a in assessments.items()
        },
        "sentence_feedback": [
            s.model_dump() for s in result.sentence_feedback if s.original.strip() and s.original in essay_text
        ],
    }
    return scores, feedback


class ScoringJobPayload(BaseModel):
    submissionId: str
    # Null for public and batch submissions, which have no assignment or student.
    assignmentId: Optional[str] = None
    studentId: Optional[str] = None
    # Set for batch submissions: every essay in one batch goes to the same grader.
    batchId: Optional[str] = None
    attemptNumber: Optional[int] = None
    taskPrompt: str
    taskType: str
    taskImageUrl: Optional[str] = None
    essayText: str
    wordCount: int
    submittedAt: str
