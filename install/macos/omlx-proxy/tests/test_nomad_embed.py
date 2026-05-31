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


@pytest.mark.asyncio
async def test_embeddings_forwarded_to_embed_ollama(monkeypatch):
    captured = {}
    async def fake_post(self, url, json=None, **kw):
        captured["url"] = url; captured["json"] = json
        return httpx.Response(200, json={"embedding": [0.1, 0.2]})
    monkeypatch.setattr(nomad_embed.httpx.AsyncClient, "post", fake_post)
    out = await nomad_embed._forward({"model": "nomic-embed-text", "prompt": "hi"})
    assert captured["url"] == "http://embed:11435/api/embeddings"
    assert out["embedding"] == [0.1, 0.2]
