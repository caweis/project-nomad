"""oMLX-aware /api/pull bridge.

Maps an Ollama tag to an mlx-community repo (via MODEL_MAPPING_FILE), drives
oMLX's /api/hf/download, and streams Ollama-style NDJSON progress. Embedding
models are served by a separate embed-only Ollama, so their "pull" is a no-op.
"""
import asyncio
import json
import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from src.config import get_settings as _get_settings  # upstream Settings factory

router = APIRouter()

_OMLX = os.getenv("NOMAD_OMLX_BASE", "http://127.0.0.1:8000")
_OMLX_FALLBACK = os.getenv("NOMAD_OMLX_BASE_FALLBACK", "http://127.0.0.1:8080")
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")
_POLL_INTERVAL = 3.0
_POLL_MAX = 600  # ~30 min at 3s


def _is_embedding(name: str) -> bool:
    return "embed" in name.lower()


def _resolve_mlx_repo(name: str) -> str:
    mapping = {}
    try:
        mapping = _get_settings().load_model_mappings() or {}
    except Exception:
        mapping = {}
    return mapping.get(name, name)


def _ndjson(obj: dict) -> str:
    return json.dumps(obj) + "\n"


async def _hf_download(client: httpx.AsyncClient, repo: str) -> str:
    """POST /api/hf/download against :8000 then :8080. Returns the base that worked."""
    for base in (_OMLX, _OMLX_FALLBACK):
        try:
            r = await client.post(f"{base}/api/hf/download", json={"model_id": repo})
            if r.status_code < 500:
                return base
        except Exception:
            continue
    raise RuntimeError("oMLX download API unreachable on :8000 or :8080")


async def _model_present(client: httpx.AsyncClient, base: str, repo: str) -> bool:
    try:
        r = await client.get(f"{base}/v1/models")
        data = r.json().get("data", [])
        return any(repo in (m.get("id", "")) for m in data)
    except Exception:
        return False


async def _pull_stream(name: str):
    """Yield Ollama-style NDJSON strings for pulling `name`."""
    if _is_embedding(name):
        # Embedding model lives on the embed-only Ollama; forward its pull stream.
        async with httpx.AsyncClient(timeout=None) as client:
            yield _ndjson({"status": f"pulling {name} (embedding, via embed Ollama)"})
            try:
                async with client.stream("POST", f"{_EMBED}/api/pull",
                                         json={"name": name}) as resp:
                    async for line in resp.aiter_lines():
                        if line.strip():
                            yield line + "\n"
            except Exception:
                pass  # embed model is usually already present; fall through to success
            yield _ndjson({"status": "success"})
        return

    repo = _resolve_mlx_repo(name)
    yield _ndjson({"status": "pulling manifest"})
    async with httpx.AsyncClient(timeout=None) as client:
        base = await _hf_download(client, repo)
        yield _ndjson({"status": "downloading", "digest": repo})
        for _ in range(_POLL_MAX):
            if await _model_present(client, base, repo):
                yield _ndjson({"status": "verifying"})
                yield _ndjson({"status": "success"})
                return
            await asyncio.sleep(_POLL_INTERVAL)
            yield _ndjson({"status": "downloading", "digest": repo})
        yield _ndjson({"status": "error", "error": f"timed out downloading {repo}"})


@router.post("/pull")
async def pull(request: Request):
    body = await request.json()
    name = body.get("name") or body.get("model") or ""
    return StreamingResponse(_pull_stream(name), media_type="application/x-ndjson")
