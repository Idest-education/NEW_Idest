import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
# Identifies this grader in ai_model_versions. Bump it whenever the system
# prompt, the response schema, or the generation config changes — otherwise two
# different graders share one row and the analysis compares them as one.
SCORER_REVISION = os.getenv("SCORER_REVISION", "2026-09-21-v1")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://localhost:5672")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
