import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://localhost:5672")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
