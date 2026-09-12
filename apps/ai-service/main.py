import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from worker import ScoringWorker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-service")

worker_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker_task
    worker = ScoringWorker()
    worker_task = asyncio.create_task(worker.start())
    logger.info("Started AI Scoring Worker task in background.")
    yield
    if worker_task:
        worker_task.cancel()
        logger.info("Cancelled AI Scoring Worker task.")

app = FastAPI(
    title="Idest AI Scoring Service",
    description="Microservice for automated IELTS Writing scoring via Gemini LLM and RabbitMQ",
    version="1.0.0",
    lifespan=lifespan,
)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-service"}
