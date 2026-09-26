import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
# Identifies this grader in ai_model_versions. Bump it whenever the system
# prompt, the response schema, or the generation config changes — otherwise two
# different graders share one row and the analysis compares them as one.
SCORER_REVISION = os.getenv("SCORER_REVISION", "2026-09-26-v3")
# How much Gemini may reason before answering. Thinking tokens bill as OUTPUT,
# and output is roughly 90% of the cost of scoring one essay, so the cheapest
# level that still grades well is pinned rather than left to the model default.
# MINIMAL | LOW | MEDIUM | HIGH, or empty to send no thinking config at all —
# needed for models that do not accept thinking_level and would return 400.
GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "MINIMAL").strip().upper()
# Gemini flash models are natively multimodal, so a Task 1 chart is on by default.
GEMINI_SUPPORTS_VISION = os.getenv("GEMINI_SUPPORTS_VISION", "true").lower() not in ("false", "0", "no")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://localhost:5672")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))

# Floor on the gap between two scoring calls, in seconds. prefetch_count=1
# already serialises jobs, so the provider sees at most one call per this
# interval. 6.0s = 10 requests per minute, which fits inside the Gemini free
# tier per-minute cap with room for the retries a burst triggers.
MIN_SECONDS_BETWEEN_CALLS = float(os.getenv("MIN_SECONDS_BETWEEN_CALLS", "6.0"))

# Exponential backoff for retryable provider failures. A 429 answers with its
# own delay when it carries one; these bound the cases that do not.
RETRY_BASE_SECONDS = float(os.getenv("RETRY_BASE_SECONDS", "2.0"))
RETRY_MAX_SECONDS = float(os.getenv("RETRY_MAX_SECONDS", "60.0"))

# Which grader the worker uses: "gemini", "ollama", or "stub". Left empty it
# picks gemini when GEMINI_API_KEY is set and stub otherwise, which is how the
# service behaved before providers were selectable.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "").strip().lower()

# Local grader, for development that must not spend provider quota. Its results
# are labelled provider "ollama" and belong out of the benchmark dataset.
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")
# A 7B model on CPU answers in tens of seconds, not the couple a hosted API takes.
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "180.0"))
# The default model (qwen2.5:7b-instruct) is text-only. Flip this only once a
# vision model (e.g. qwen2.5vl) is the one actually pulled.
OLLAMA_SUPPORTS_VISION = os.getenv("OLLAMA_SUPPORTS_VISION", "false").lower() not in ("false", "0", "no")

# Reuses a stored result when the same grader already scored the same essay
# against the same prompt. Demos and dev reruns stop costing calls.
SCORING_CACHE_ENABLED = os.getenv("SCORING_CACHE_ENABLED", "true").lower() not in (
    "false",
    "0",
    "no",
)
SCORING_CACHE_DIR = os.getenv(
    "SCORING_CACHE_DIR", str(Path(__file__).resolve().parent / ".cache" / "scoring")
)

# --- OpenAI-compatible graders -------------------------------------------------
# Same request shape for all of them; only the endpoint, key and model differ.

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
# gpt-5-mini and gpt-4o-class models are vision-capable; on by default.
OPENAI_SUPPORTS_VISION = os.getenv("OPENAI_SUPPORTS_VISION", "true").lower() not in ("false", "0", "no")

# The third grader: an open-weight Chinese model on whichever host you prefer.
# CN_HOST picks a preset (huggingface, openrouter, deepseek, dashscope, custom)
# and every field below overrides that preset when set. The key falls back to
# the host's own env var, so an existing HF_TOKEN or OPENROUTER_API_KEY is
# picked up without copying it.
CN_HOST = os.getenv("CN_HOST", "huggingface")
CN_API_KEY = os.getenv("CN_API_KEY", "")
CN_BASE_URL = os.getenv("CN_BASE_URL", "")
CN_MODEL = os.getenv("CN_MODEL", "")
CN_STRUCTURED_MODE = os.getenv("CN_STRUCTURED_MODE", "")
# Off by default: most presets here default to a text-only model. Flip this
# only once CN_MODEL actually names a vision-language model (e.g. a -VL build).
CN_SUPPORTS_VISION = os.getenv("CN_SUPPORTS_VISION", "false").lower() not in ("false", "0", "no")

OPENAI_COMPATIBLE_TIMEOUT_SECONDS = float(os.getenv("OPENAI_COMPATIBLE_TIMEOUT_SECONDS", "120.0"))

# Guards against a runaway download when fetching a Task 1 chart/graph/diagram
# for a vision-capable grader. Matches the server's own upload cap.
TASK_IMAGE_MAX_BYTES = int(os.getenv("TASK_IMAGE_MAX_BYTES", str(5 * 1024 * 1024)))
TASK_IMAGE_FETCH_TIMEOUT_SECONDS = float(os.getenv("TASK_IMAGE_FETCH_TIMEOUT_SECONDS", "15.0"))

# How long a grader stays out of the rotation after a rate limit that carried no
# retry delay of its own. Long enough for a per-minute cap to reset several
# times over; a per-day cap outlives it, and the grader simply cools again.
ROTATION_COOLDOWN_SECONDS = float(os.getenv("ROTATION_COOLDOWN_SECONDS", "300.0"))
