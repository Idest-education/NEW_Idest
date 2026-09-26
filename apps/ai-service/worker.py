import asyncio
import json
import logging
import random
import aio_pika
from config import (
    MAX_RETRIES,
    RABBITMQ_URL,
    RETRY_BASE_SECONDS,
    RETRY_MAX_SECONDS,
)
from retry import next_delay
from scorer import build_scorer
from schemas import ScoringJobPayload

logger = logging.getLogger(__name__)

class ScoringWorker:
    def __init__(self, rabbitmq_url: str = RABBITMQ_URL, scorer=None):
        self.rabbitmq_url = rabbitmq_url
        # One provider per process, chosen at startup. Injectable for tests.
        self.scorer = scorer if scorer is not None else build_scorer()
        self.queue_name = "ai_scoring_queue"
        self.result_queue_name = "ai_scoring_results_queue"
        # Injected so tests do not spend the backoff in real time.
        self.sleep = asyncio.sleep
        self.jitter = random.random

    async def start(self):
        try:
            connection = await aio_pika.connect_robust(self.rabbitmq_url)
            channel = await connection.channel()
            await channel.set_qos(prefetch_count=1)

            queue = await channel.declare_queue(self.queue_name, durable=True)
            result_queue = await channel.declare_queue(self.result_queue_name, durable=True)

            logger.info(f"AI Worker listening on queue {self.queue_name}...")

            async with queue.iterator() as queue_iter:
                async for message in queue_iter:
                    async with message.process():
                        payload_data = json.loads(message.body.decode())
                        await self.process_job(channel, payload_data)
        except Exception as e:
            logger.warning(f"RabbitMQ consumer connection error: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)

    async def score_with_retries(
        self,
        submission_id,
        task_prompt: str,
        task_type: str,
        essay_text: str,
        task_image_url: str | None = None,
    ) -> dict:
        """Scores one essay, retrying only the failures another call can fix.

        A retry that would not help, or that the provider wants delayed longer
        than we hold a message, is not made at all — the submission fails and
        stays retryable. Rate limiting is not done here: the scorer built by
        build_scorer already holds metered calls apart, below its cache.
        """
        attempt = 0
        while True:
            attempt += 1
            try:
                return await self.scorer.score_essay(task_prompt, task_type, essay_text, task_image_url)
            except Exception as exc:
                logger.error(f"Scoring attempt {attempt} failed for {submission_id}: {exc}")

                if attempt >= MAX_RETRIES:
                    return self._failed_result(
                        f"Maximum retries ({MAX_RETRIES}) exceeded: {exc}"
                    )

                delay = next_delay(
                    attempt,
                    exc,
                    base=RETRY_BASE_SECONDS,
                    cap=RETRY_MAX_SECONDS,
                    jitter=self.jitter(),
                )
                if delay is None:
                    return self._failed_result(f"Not retryable: {exc}")

                logger.info(
                    f"Retrying {submission_id} in {delay:.2f}s "
                    f"(attempt {attempt + 1} of {MAX_RETRIES})"
                )
                await self.sleep(delay)

    @staticmethod
    def _failed_result(reason: str) -> dict:
        return {
            "status": "failed",
            "scores": {},
            "feedback": {"error": reason},
        }

    async def process_job(self, channel, data: dict):
        submission_id = data.get("submissionId")
        task_prompt = data.get("taskPrompt", "")
        task_type = data.get("taskType", "task_2")
        essay_text = data.get("essayText", "")
        task_image_url = data.get("taskImageUrl")

        logger.info(f"Processing AI scoring for submission {submission_id}")

        result = await self.score_with_retries(
            submission_id, task_prompt, task_type, essay_text, task_image_url
        )

        result_payload = {
            "submissionId": submission_id,
            "scorerType": "ai",
            "status": result["status"],
            "scores": result.get("scores", {}),
            "feedback": result.get("feedback", {}),
            "rawOutput": result.get("raw_output", {}),
            "processingMetadata": result.get("processing_metadata", {}),
            # Rule 3: the result names its own grader. When several graders share
            # one worker, asking the scorer afterwards can name the wrong one, so
            # the descriptor the provider attached wins. Failures carry none, and
            # fall back to whichever grader the scorer says ran last.
            "modelDescriptor": result.get("model_descriptor") or self.scorer.descriptor(),
        }

        # Publish result to result queue
        await channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(result_payload).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ),
            routing_key=self.result_queue_name,
        )
        logger.info(f"Published scoring result for {submission_id} (status: {result['status']})")
