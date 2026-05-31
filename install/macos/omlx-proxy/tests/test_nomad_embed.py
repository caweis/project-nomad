import os, sys
import httpx
import pytest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"
from src.routers import nomad_embed  # noqa: E402


class _FakeReq:
    def __init__(self, body): self._body = body
    async def json(self): return self._body


@pytest.mark.asyncio
async def test_embeddings_forwarded_to_embed_ollama(monkeypatch):
    captured = {}
    async def fake_post(self, url, json=None, **kw):
        captured["url"] = url; captured["json"] = json
        return httpx.Response(200, json={"embedding": [0.1, 0.2]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(nomad_embed.httpx.AsyncClient, "post", fake_post)
    out = await nomad_embed._forward({"model": "nomic-embed-text", "prompt": "hi"})
    assert captured["url"] == "http://embed:11435/api/embeddings"
    assert out["embedding"] == [0.1, 0.2]


@pytest.mark.asyncio
async def test_embeddings_propagates_upstream_status(monkeypatch):
    from fastapi import HTTPException
    async def fake_post(self, url, json=None, **kw):
        return httpx.Response(503, text="model loading", request=httpx.Request("POST", url))
    monkeypatch.setattr(nomad_embed.httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as ei:
        await nomad_embed.embeddings(_FakeReq({"model": "nomic-embed-text"}))
    assert ei.value.status_code == 503


@pytest.mark.asyncio
async def test_embeddings_502_when_embed_down(monkeypatch):
    from fastapi import HTTPException
    async def boom(self, url, json=None, **kw):
        raise httpx.ConnectError("refused", request=httpx.Request("POST", url))
    monkeypatch.setattr(nomad_embed.httpx.AsyncClient, "post", boom)
    with pytest.raises(HTTPException) as ei:
        await nomad_embed.embeddings(_FakeReq({"model": "nomic-embed-text"}))
    assert ei.value.status_code == 502
