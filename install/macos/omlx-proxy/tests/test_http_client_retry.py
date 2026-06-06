import asyncio
import os
import sys
from pathlib import Path

import httpx
import pytest

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")

from src.utils.http_client import RetryClient  # noqa: E402


@pytest.fixture
def client():
    c = RetryClient()
    try:
        yield c
    finally:
        asyncio.run(c.close())


def _resp(status: int) -> httpx.Response:
    return httpx.Response(status_code=status)


def test_503_is_not_retried(client):
    # The fix: 503 "busy" must be terminal-for-now so the slot frees and the
    # shared circuit breaker is not tripped into blocking all chats.
    assert client._should_retry(_resp(503), None) is False


@pytest.mark.parametrize("status", [500, 502, 504, 429, 408, 425])
def test_other_transient_statuses_are_retried(client, status):
    assert client._should_retry(_resp(status), None) is True


@pytest.mark.parametrize("status", [200, 201, 400, 401, 404])
def test_success_and_non_transient_4xx_not_retried(client, status):
    assert client._should_retry(_resp(status), None) is False


def test_network_and_timeout_errors_are_retried(client):
    assert client._should_retry(None, httpx.ConnectError("down")) is True
    assert client._should_retry(None, httpx.ReadTimeout("slow")) is True


def test_generic_error_not_retried(client):
    assert client._should_retry(None, ValueError("nope")) is False


def test_no_response_no_error_not_retried(client):
    assert client._should_retry(None, None) is False
