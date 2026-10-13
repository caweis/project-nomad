"""Request bodies shared by the chat and embeddings routes must be JSON objects."""

import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")

from src.routers.embeddings import create_embeddings_openai_style  # noqa: E402
from src.utils.request_body import get_body_json  # noqa: E402


def _request(body: bytes) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/v1/embeddings",
        "headers": [],
        "query_string": b"",
    }

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [b"[]", b"null", b'"hello"', b"42"])
async def test_non_object_json_returns_bad_request(body):
    request = _request(body)

    with pytest.raises(HTTPException) as error:
        await get_body_json(request)

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_embeddings_route_rejects_array_before_reading_model():
    request = _request(b"[]")

    with pytest.raises(HTTPException) as error:
        await create_embeddings_openai_style(request)

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_object_body_is_cached_for_repeated_read():
    request = _request(b'{"model":"test","input":"hello"}')

    first = await get_body_json(request)
    second = await get_body_json(request)

    assert first == second == {"model": "test", "input": "hello"}
