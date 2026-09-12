import asyncio
import json
import logging
import aio_pika
from config import RABBITMQ_URL, MAX_RETRIES
from scorer import GeminiIELTSScorer
from schemas import ScoringJobPayload

logger = logging.getLogger(__name__)

class ScoringWorker:
    def __init__(self, rabbitmq_url: str = RABBITMQ_URL):
        self.rabbitmq_url = rabbitmq_url
        self.scorer = GeminiIELTSScorer()
        self.queue_name = "ai_scoring_queue"
        self.result_queue_name = "ai_scoring_results_queue"

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

    async def process_job(self, channel, data: dict):
        submission_id = data.get("submissionId")
        task_prompt = data.get("taskPrompt", "")
        task_type = data.get("taskType", "task_2")
        essay_text = data.get("essayText", "")

        logger.info(f"Processing AI scoring for submission {submission_id}")

        retry_count = 0
        result = None

        while retry_count < MAX_RETRIES:
            try:
                result = await self.scorer.score_essay(task_prompt, task_type, essay_text)
                break
            except Exception as e:
                retry_count += 1
                logger.error(f"Scoring attempt {retry_count} failed for {submission_id}: {e}")
                if retry_count >= MAX_RETRIES:
                    result = {
                        "status": "failed",
                        "scores": {},
                        "feedback": {"error": f"Maximum retries ({MAX_RETRIES}) exceeded: {str(e)}"},
                    }

        result_payload = {
            "submissionId": submission_id,
            "scorerType": "ai",
            "status": result["status"],
            "scores": result.get("scores", {}),
            "feedback": result.get("feedback", {}),
            "rawOutput": result.get("raw_output", {}),
            "processingMetadata": result.get("processing_metadata", {}),
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
