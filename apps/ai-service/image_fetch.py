"""Fetches a Task 1 chart/graph/diagram so a vision-capable grader can see it.

The job payload carries only the Cloudinary URL, not the image bytes, so a
retried or resubmitted job always reads whatever image is live on the
assignment at scoring time rather than a stale copy pulled through the queue.
"""

import httpx

from config import TASK_IMAGE_FETCH_TIMEOUT_SECONDS, TASK_IMAGE_MAX_BYTES

_EXTENSION_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "heic": "image/heic",
    "heif": "image/heif",
}
DEFAULT_MIME = "image/jpeg"


def _mime_from_url(url: str) -> str:
    suffix = url.rsplit(".", 1)[-1].split("?", 1)[0].lower()
    return _EXTENSION_MIME.get(suffix, DEFAULT_MIME)


async def fetch_task_image(url: str) -> tuple[bytes, str]:
    """The image's raw bytes and MIME type.

    A fetch failure (timeout, 404, 5xx) is left as the httpx exception it
    already is — retry.py classifies those by status code the same way it
    already classifies every provider's own HTTP errors. Only an oversized
    body is raised here, as a ValueError: not a transient condition a retry
    would fix.
    """
    async with httpx.AsyncClient(timeout=TASK_IMAGE_FETCH_TIMEOUT_SECONDS) as client:
        response = await client.get(url)
        response.raise_for_status()

    if len(response.content) > TASK_IMAGE_MAX_BYTES:
        raise ValueError(f"Task image at {url} exceeds the {TASK_IMAGE_MAX_BYTES}-byte limit")

    content_type = response.headers.get("content-type", "").split(";")[0].strip()
    mime = content_type if content_type.startswith("image/") else _mime_from_url(url)

    return response.content, mime
