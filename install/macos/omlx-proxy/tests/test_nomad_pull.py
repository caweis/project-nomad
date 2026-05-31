import json, os, sys
import httpx
import pytest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_OMLX_BASE"] = "http://omlx:8000"
os.environ["NOMAD_OMLX_BASE_FALLBACK"] = "http://omlx:8080"
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"

from src.routers import nomad_pull  # noqa: E402


@pytest.mark.asyncio
async def test_chat_pull_emits_success_ndjson(monkeypatch):
    """A chat model: download is fired, /v1/models then shows it, NDJSON ends success."""
    posted = {}

    async def fake_post(url, json=None, **kw):
        posted["url"] = url; posted["json"] = json
        return httpx.Response(200, json={"status": "started"})

    seen = {"n": 0}
    async def fake_get(url, **kw):
        seen["n"] += 1
        models = [] if seen["n"] < 2 else [{"id": "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit"}]
        return httpx.Response(200, json={"data": models})

    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit")
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "post", lambda self, url, **k: fake_post(url, **k))
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "get", lambda self, url, **k: fake_get(url, **k))
    monkeypatch.setattr(nomad_pull, "_POLL_INTERVAL", 0)

    lines = [json.loads(l) async for l in nomad_pull._pull_stream("llama3.1:8b")]
    assert posted["json"]["model_id"] == "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit"
    assert "/api/hf/download" in posted["url"]
    assert lines[-1]["status"] == "success"


@pytest.mark.asyncio
async def test_embedding_pull_is_noop_success(monkeypatch):
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: True)
    lines = [json.loads(l) async for l in nomad_pull._pull_stream("nomic-embed-text")]
    assert lines[-1]["status"] == "success"
