"""Route /api/embeddings to the embed-only Ollama (hybrid backend).

Keeps embedding vectors bit-identical to what Qdrant already holds, so a backend
switch never forces a reindex. Chat/generation still go to oMLX via the other
routers; only embeddings are diverted here.
"""
import os
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")


async def _forward(body: dict) -> dict:
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)) as client:
        r = await client.post(f"{_EMBED}/api/embeddings", json=body)
        return r.json()


@router.post("/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    return JSONResponse(await _forward(body))
