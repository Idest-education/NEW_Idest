import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from worker import ScoringWorker
from extraction.worker import ExtractionWorker
from chat import ChatWorker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-service")

@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(ScoringWorker().start()),
        asyncio.create_task(ExtractionWorker().start()),
        asyncio.create_task(ChatWorker().start()),
    ]
    logger.info("Started scoring, extraction and chat workers in background.")
    yield
    for task in tasks:
        task.cancel()
    logger.info("Cancelled background workers.")

app = FastAPI(
    title="Idest AI Scoring Service",
    description="Microservice for automated IELTS Writing scoring via Gemini LLM and RabbitMQ",
    version="1.0.0",
    lifespan=lifespan,
)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-service"}
