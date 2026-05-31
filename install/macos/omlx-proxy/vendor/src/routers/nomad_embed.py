"""Route /api/embeddings to the embed-only Ollama (hybrid backend).

Keeps embedding vectors bit-identical to what Qdrant already holds, so a backend
switch never forces a reindex. Chat/generation still go to oMLX via the other
routers; only embeddings are diverted here.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")


async def _forward(body: dict) -> dict:
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)) as client:
        r = await client.post(f"{_EMBED}/api/embeddings", json=body)
        r.raise_for_status()
        return r.json()


@router.post("/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    try:
        result = await _forward(body)
    except httpx.HTTPStatusError as e:
        # Propagate the embed Ollama's status + a trimmed body so failures aren't 200s.
        raise HTTPException(status_code=e.response.status_code,
                            detail=f"embed Ollama: {e.response.text[:200]}")
    except httpx.HTTPError as e:
        # Connectivity/timeout: the embed Ollama isn't reachable.
        raise HTTPException(status_code=502, detail=f"embed Ollama unreachable: {e}")
    return JSONResponse(result)
