"""Consumes extraction jobs: read the uploaded file, publish the essays found."""

import asyncio
import base64
import json
import logging
import os
import random

import aio_pika

from config import MAX_RETRIES, RABBITMQ_URL, RETRY_BASE_SECONDS, RETRY_MAX_SECONDS
from extraction import readers
from extraction.essays import apply_mapping, essay_from_images, map_sheet, split_document, transcribe_all
from extraction.llm import ExtractionLLM, build_extractor
from image_fetch import _mime_from_url
from retry import next_delay

logger = logging.getLogger(__name__)

def decode_files(job: dict) -> list[tuple[bytes, str]]:
    """The uploaded bytes ride in the job itself, base64-encoded, one entry per page."""
    return [(base64.b64decode(f["data"]), f.get("mime") or "") for f in job["files"]]


def _stem(file_name: str) -> str:
    return os.path.splitext(file_name)[0] or file_name


async def extract(llm: ExtractionLLM, job: dict) -> dict:
    """The essays in one uploaded file. Raises on failure; the caller retries."""
    kind = job["kind"]
    name = job.get("fileName") or "file"
    files = decode_files(job)
    mapping = None
    headers: list[str] = []

    if kind == "image":
        images = [(data, mime if mime.startswith("image/") else _mime_from_url(name)) for data, mime in files]
        essays = await essay_from_images(llm, images, _stem(name))
    elif kind == "pdf":
        pages = readers.read_pdf(files[0][0])
        scanned = [i for i, p in enumerate(pages) if p.image is not None]
        if scanned:
            texts, _ = await transcribe_all(llm, [(pages[i].image, "image/png") for i in scanned])
            for i, text in zip(scanned, texts):
                pages[i].text = text
        essays = await split_document(llm, "\n\n".join(p.text for p in pages), name)
    elif kind in ("doc", "docx"):
        text = readers.read_doc(files[0][0]) if kind == "doc" else readers.read_docx(files[0][0])
        if not text:
            raise ValueError("The document has no text")
        essays = await split_document(llm, text, name)
    elif kind in ("xls", "xlsx", "csv"):
        sheets = readers.read_sheets(files[0][0], kind)
        m = await map_sheet(llm, sheets)
        essays, headers = apply_mapping(m, sheets)
        mapping = m.model_dump()
    else:
        raise ValueError(f"Unsupported file kind: {kind}")

    if not essays:
        raise ValueError("No essays found in the file")
    return {
        "essays": [e.to_payload() for e in essays],
        "mapping": mapping,
        "headers": headers,
    }


class ExtractionWorker:
    def __init__(self, rabbitmq_url: str = RABBITMQ_URL, llm: ExtractionLLM | None = None):
        self.rabbitmq_url = rabbitmq_url
        self.llm = llm if llm is not None else build_extractor()
        self.queue_name = "ai_extraction_queue"
        self.result_queue_name = "ai_extraction_results_queue"
        self.sleep = asyncio.sleep
        self.jitter = random.random

    async def start(self):
        while True:
            try:
                connection = await aio_pika.connect_robust(self.rabbitmq_url)
                channel = await connection.channel()
                await channel.set_qos(prefetch_count=1)
                queue = await channel.declare_queue(self.queue_name, durable=True)
                await channel.declare_queue(self.result_queue_name, durable=True)
                logger.info(f"Extraction worker listening on {self.queue_name}...")
                async with queue.iterator() as queue_iter:
                    async for message in queue_iter:
                        async with message.process():
                            await self.process_job(channel, json.loads(message.body.decode()))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"Extraction consumer connection error: {e}. Retrying in 5 seconds...")
                await asyncio.sleep(5)

    async def run_with_retries(self, job: dict) -> dict:
        attempt = 0
        while True:
            attempt += 1
            try:
                return {"status": "extracted", **await extract(self.llm, job), "error": None}
            except Exception as exc:
                logger.error(f"Extraction attempt {attempt} failed for {job.get('fileId')}: {exc}")
                delay = None if attempt >= MAX_RETRIES else next_delay(
                    attempt, exc, base=RETRY_BASE_SECONDS, cap=RETRY_MAX_SECONDS, jitter=self.jitter()
                )
                if delay is None:
                    return {"status": "failed", "essays": [], "mapping": None, "headers": [], "error": str(exc)[:500]}
                await self.sleep(delay)

    async def process_job(self, channel, job: dict):
        result = {"fileId": job.get("fileId"), "extractor": self.llm.name, **await self.run_with_retries(job)}
        await channel.default_exchange.publish(
            aio_pika.Message(body=json.dumps(result).encode(), delivery_mode=aio_pika.DeliveryMode.PERSISTENT),
            routing_key=self.result_queue_name,
        )
        logger.info(f"Published extraction result for {job.get('fileId')} ({result['status']}, {len(result['essays'])} essays)")
