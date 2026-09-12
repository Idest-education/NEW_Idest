from pydantic import BaseModel, Field
from typing import List, Optional

class CriterionScores(BaseModel):
    task_response: float = Field(ge=0, le=9)
    coherence_cohesion: float = Field(ge=0, le=9)
    lexical_resource: float = Field(ge=0, le=9)
    grammatical_range_accuracy: float = Field(ge=0, le=9)
    overall: float = Field(ge=0, le=9)

class SentenceFeedback(BaseModel):
    sentence_index: int
    category: str
    original: str
    suggestion: str
    explanation: str

class Feedback(BaseModel):
    summary: str
    strengths: List[str]
    improvements: List[str]
    sentence_feedback: Optional[List[SentenceFeedback]] = []

class IELTSScoringResult(BaseModel):
    scores: CriterionScores
    feedback: Feedback

class ScoringJobPayload(BaseModel):
    submissionId: str
    assignmentId: str
    studentId: str
    attemptNumber: int
    taskPrompt: str
    taskType: str
    essayText: str
    wordCount: int
    submittedAt: str
