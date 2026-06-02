"""Route embeddings to the embed-only Ollama (hybrid backend).

The admin generates RAG embeddings against this proxy; we divert them to a small
embed-only Ollama (nomic-embed-text) instead of oMLX, so vectors stay bit-identical
to what Qdrant holds and a backend switch never forces a reindex.

Both API styles are intercepted: the Ollama style (/api/embeddings) AND the
OpenAI style (/v1/embeddings). The admin's RAG client uses /v1/embeddings — if we
only caught /api, it would fall through to oMLX, which serves no embedding model
(observed as: "POST /v1/embeddings -> 404: Model 'nomic-embed-text:v1.5' not found").
The request is forwarded to the matching endpoint on the embed Ollama so the
response shape (OpenAI vs Ollama) is preserved for the caller.

The newer Ollama /api/embed endpoint (used by the ollama npm client's .embed(),
which the admin's RAG ingest calls) is intercepted too. Ollama has no /v1/embed,
so both /api/embed and /v1/embed map to the native /api/embed on the embed Ollama.
Without this, /api/embed would fall through to oMLX and 404 — breaking ingestion.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")


async def _forward(target_path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)) as client:
        r = await client.post(f"{_EMBED}{target_path}", json=body)
        r.raise_for_status()
        return r.json()


@router.post("/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    # Preserve the caller's API style so the response shape matches what it expects:
    # /v1/embeddings (OpenAI) -> embed Ollama /v1/embeddings; otherwise Ollama /api.
    target = "/v1/embeddings" if "/v1/" in request.url.path else "/api/embeddings"
    try:
        result = await _forward(target, body)
    except httpx.HTTPStatusError as e:
        # Propagate the embed Ollama's status + a trimmed body so failures aren't 200s.
        raise HTTPException(status_code=e.response.status_code,
                            detail=f"embed Ollama: {e.response.text[:200]}")
    except httpx.HTTPError as e:
        # Connectivity/timeout: the embed Ollama isn't reachable.
        raise HTTPException(status_code=502, detail=f"embed Ollama unreachable: {e}")
    return JSONResponse(result)


@router.post("/embed")
async def embed(request: Request):
    # The ollama npm client's .embed() POSTs to /api/embed. Ollama exposes this only
    # under /api (no /v1/embed), so both /api/embed and /v1/embed forward to /api/embed.
    body = await request.json()
    try:
        result = await _forward("/api/embed", body)
    except httpx.HTTPStatusError as e:
        # Propagate the embed Ollama's status + a trimmed body so failures aren't 200s.
        raise HTTPException(status_code=e.response.status_code,
                            detail=f"embed Ollama: {e.response.text[:200]}")
    except httpx.HTTPError as e:
        # Connectivity/timeout: the embed Ollama isn't reachable.
        raise HTTPException(status_code=502, detail=f"embed Ollama unreachable: {e}")
    return JSONResponse(result)
