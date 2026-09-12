import json
import logging
from config import GEMINI_API_KEY, GEMINI_MODEL
from schemas import IELTSScoringResult

logger = logging.getLogger(__name__)

IELTS_SYSTEM_PROMPT = """
You are an expert IELTS Writing Examiner. Evaluate the student essay based strictly on the official IELTS 9-band rubric for the specified Task Type (Task 1 or Task 2).
You MUST provide structured JSON output adhering exactly to the specified JSON schema, containing:
1. Criterion scores: task_response, coherence_cohesion, lexical_resource, grammatical_range_accuracy, and overall band score (0-9 with 0.5 increments).
2. Feedback: summary, strengths (list), improvements (list), and sentence_feedback (list of corrections).
"""

class GeminiIELTSScorer:
    def __init__(self, api_key: str = GEMINI_API_KEY, model_name: str = GEMINI_MODEL):
        self.api_key = api_key
        self.model_name = model_name
        self.client = None
        if self.api_key:
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Could not initialize Google GenAI SDK: {e}")

    async def score_essay(self, task_prompt: str, task_type: str, essay_text: str) -> dict:
        if not self.client:
            return self._generate_stub_result(task_prompt, essay_text)

        prompt = f"Task Type: {task_type}\nPrompt: {task_prompt}\nStudent Essay:\n{essay_text}"
        
        try:
            from google.genai import types
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=IELTS_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=IELTSScoringResult,
                ),
            )
            raw_text = response.text
            parsed_data = json.loads(raw_text)
            return {
                "status": "completed",
                "scores": parsed_data.get("scores"),
                "feedback": parsed_data.get("feedback"),
                "raw_output": parsed_data,
                "processing_metadata": {
                    "model_name": self.model_name,
                    "provider": "google",
                }
            }
        except Exception as e:
            logger.error(f"Gemini API scoring error: {e}")
            raise e

    def _generate_stub_result(self, task_prompt: str, essay_text: str) -> dict:
        return {
            "status": "completed",
            "scores": {
                "task_response": 6.5,
                "coherence_cohesion": 7.0,
                "lexical_resource": 6.5,
                "grammatical_range_accuracy": 6.0,
                "overall": 6.5,
            },
            "feedback": {
                "summary": "The essay addresses the task prompt well with clear overall structure.",
                "strengths": ["Clear position presented", "Logical paragraph organization"],
                "improvements": ["Enhance vocabulary precision", "Vary sentence structures"],
                "sentence_feedback": [],
            },
            "raw_output": {"stub": True},
            "processing_metadata": {
                "model_name": "stub-gemini-model",
                "provider": "google-stub",
            }
        }
