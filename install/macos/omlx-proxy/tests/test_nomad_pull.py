import json, os, sys
import httpx
import pytest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_OMLX_BASE"] = "http://omlx:8000"
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"

from src.routers import nomad_pull  # noqa: E402

_REPO = "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit"


@pytest.mark.asyncio
async def test_chat_pull_emits_progress_then_success(monkeypatch):
    """Chat model: POSTs repo_id to /admin/api/hf/download, polls the task to
    completion, emits real total/completed progress and ends with success."""
    posted = {}

    async def fake_post(url, json=None, **kw):
        posted["url"] = url; posted["json"] = json
        return httpx.Response(200, json={"success": True, "task": {"repo_id": _REPO, "status": "pending"}})

    seen = {"n": 0}
    async def fake_get(url, **kw):
        seen["n"] += 1
        # first poll: downloading half; second poll: completed
        if seen["n"] < 2:
            t = {"repo_id": _REPO, "status": "downloading", "total_size": 1000, "downloaded_size": 500, "created_at": 1}
        else:
            t = {"repo_id": _REPO, "status": "completed", "total_size": 1000, "downloaded_size": 1000, "created_at": 1}
        return httpx.Response(200, json={"tasks": [t]})

    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: _REPO)
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "post", lambda self, url, **k: fake_post(url, **k))
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "get", lambda self, url, **k: fake_get(url, **k))
    monkeypatch.setattr(nomad_pull, "_POLL_INTERVAL", 0)

    lines = [json.loads(l) async for l in nomad_pull._pull_stream("llama3.1:8b")]
    assert posted["json"]["repo_id"] == _REPO
    assert posted["url"].endswith("/admin/api/hf/download")
    # a downloading line carries real byte counts
    dl = [l for l in lines if l["status"] == "downloading" and "total" in l]
    assert dl and dl[0]["total"] == 1000 and dl[0]["completed"] == 500
    assert lines[-1]["status"] == "success"


@pytest.mark.asyncio
async def test_completed_with_no_bytes_emits_100pct_sentinel(monkeypatch):
    """oMLX may report a model already-complete with NO byte counts. The stream
    must STILL emit a downloading frame at 100% (sentinel total/completed=1) so
    the admin's progress guard (`if chunk.completed && chunk.total`) fires once —
    otherwise the UI shows 0 progress and the download looks instant."""
    async def fake_post(url, json=None, **kw):
        return httpx.Response(200, json={"success": True, "task": {"repo_id": _REPO, "status": "completed"}})

    async def fake_get(url, **kw):
        # completed immediately, no total_size / downloaded_size
        return httpx.Response(200, json={"tasks": [
            {"repo_id": _REPO, "status": "completed", "created_at": 1}]})

    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: _REPO)
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "post", lambda self, url, **k: fake_post(url, **k))
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "get", lambda self, url, **k: fake_get(url, **k))
    monkeypatch.setattr(nomad_pull, "_POLL_INTERVAL", 0)

    lines = [json.loads(l) async for l in nomad_pull._pull_stream("llama3.1:8b")]
    dl = [l for l in lines if l["status"] == "downloading"]
    assert dl, "a downloading frame is emitted even with no byte counts"
    assert dl[-1]["total"] == 1 and dl[-1]["completed"] == 1, "sentinel 100% frame"
    assert [l["status"] for l in lines][-2:] == ["verifying", "success"]


@pytest.mark.asyncio
async def test_chat_pull_emits_error_on_failed_task(monkeypatch):
    async def fake_post(url, json=None, **kw):
        return httpx.Response(200, json={"success": True, "task": {"repo_id": _REPO, "status": "pending"}})

    async def fake_get(url, **kw):
        return httpx.Response(200, json={"tasks": [
            {"repo_id": _REPO, "status": "error", "error": "disk full", "created_at": 1}]})

    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: _REPO)
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "post", lambda self, url, **k: fake_post(url, **k))
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "get", lambda self, url, **k: fake_get(url, **k))
    monkeypatch.setattr(nomad_pull, "_POLL_INTERVAL", 0)

    lines = [json.loads(l) async for l in nomad_pull._pull_stream("llama3.1:8b")]
    assert lines[-1]["status"] == "error"
    assert "disk full" in lines[-1]["error"]


@pytest.mark.asyncio
async def test_embedding_pull_is_noop_success(monkeypatch):
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: True)
    lines = [json.loads(l) async for l in nomad_pull._pull_stream("nomic-embed-text")]
    assert lines[-1]["status"] == "success"


@pytest.mark.asyncio
async def test_chat_pull_emits_error_ndjson_when_download_unreachable(monkeypatch):
    async def boom(client, repo):
        raise RuntimeError("oMLX download API unreachable at http://omlx:8000")
    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: "mlx-community/Foo-4bit")
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    monkeypatch.setattr(nomad_pull, "_start_download", boom)
    lines = [json.loads(l) async for l in nomad_pull._pull_stream("foo:7b")]
    assert lines[-1]["status"] == "error"
    assert "unreachable" in lines[-1]["error"]


@pytest.mark.asyncio
async def test_unmapped_model_is_refused(monkeypatch):
    """An unmapped name (resolver returns '') yields a terminal error with 'refusing to pull'."""
    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: "")
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    lines = [json.loads(l) async for l in nomad_pull._pull_stream("totally-arbitrary-model")]
    assert lines[-1]["status"] == "error"
    assert "refusing to pull" in lines[-1]["error"]
    assert "unmapped" in lines[-1]["error"]
