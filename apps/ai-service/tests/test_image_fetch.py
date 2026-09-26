"""fetch_task_image: bytes and MIME type for a Task 1 chart/graph/diagram."""

import httpx
import pytest

import config
import image_fetch
from image_fetch import fetch_task_image


def mock_client(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: original(*a, **{**kw, "transport": httpx.MockTransport(handler)}),
    )


async def test_the_bytes_and_content_type_mime_come_back(monkeypatch):
    mock_client(
        monkeypatch,
        lambda request: httpx.Response(200, headers={"content-type": "image/png"}, content=b"pngdata"),
    )

    data, mime = await fetch_task_image("https://res.cloudinary.com/demo/image/upload/chart.png")

    assert data == b"pngdata"
    assert mime == "image/png"


async def test_a_missing_content_type_falls_back_to_the_url_extension(monkeypatch):
    mock_client(monkeypatch, lambda request: httpx.Response(200, content=b"jpgdata"))

    _data, mime = await fetch_task_image("https://cdn.example.com/charts/bar-chart.jpg?v=2")

    assert mime == "image/jpeg"


async def test_an_unrecognised_extension_defaults_to_jpeg(monkeypatch):
    mock_client(monkeypatch, lambda request: httpx.Response(200, content=b"data"))

    _data, mime = await fetch_task_image("https://cdn.example.com/charts/no-extension")

    assert mime == image_fetch.DEFAULT_MIME


async def test_an_oversized_image_is_rejected(monkeypatch):
    monkeypatch.setattr(config, "TASK_IMAGE_MAX_BYTES", 10)
    monkeypatch.setattr(image_fetch, "TASK_IMAGE_MAX_BYTES", 10)
    mock_client(monkeypatch, lambda request: httpx.Response(200, content=b"x" * 11))

    with pytest.raises(ValueError, match="exceeds"):
        await fetch_task_image("https://cdn.example.com/big.png")


async def test_a_404_is_raised_for_the_caller_to_classify(monkeypatch):
    """Left as the httpx exception it already is, so retry.py's own status-code
    classification applies — the same path every provider's own HTTP call uses."""
    mock_client(monkeypatch, lambda request: httpx.Response(404, text="gone"))

    with pytest.raises(httpx.HTTPStatusError) as raised:
        await fetch_task_image("https://cdn.example.com/gone.png")

    assert raised.value.response.status_code == 404
