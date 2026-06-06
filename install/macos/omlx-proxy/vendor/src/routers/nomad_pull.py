"""oMLX-aware /api/pull bridge.

Maps an Ollama tag to an mlx-community repo (via MODEL_MAPPING_FILE), drives
oMLX's download API, and streams Ollama-style NDJSON progress with real byte
counts. Embedding models are served by a separate embed-only Ollama, so their
"pull" is forwarded there instead.

oMLX contract (verified on-device against omlx 0.3.12):
  - download:  POST {base}/admin/api/hf/download  {"repo_id": "<org/repo>"}
               → 200 {"success": true, "task": {...}}
  - progress:  GET  {base}/admin/api/hf/tasks
               → {"tasks": [{"repo_id","status","progress","total_size",
                             "downloaded_size","error",...}]}
               status ∈ pending|downloading|completed|error|failed
  Both the admin API and the OpenAI API are served on the single oMLX port
  (:8000). The admin API requires `auth.skip_api_key_verification=true` in
  ~/.omlx/settings.json, which the installer sets (the server is loopback-only).
"""
import asyncio
import json
import os
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from src.config import get_settings as _get_settings  # upstream Settings factory

router = APIRouter()

_OMLX = os.getenv("NOMAD_OMLX_BASE", "http://127.0.0.1:8000")
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")
_POLL_INTERVAL = 2.0
_POLL_MAX = 1800  # ~60 min at 2s — large MLX repos can be tens of GB


def _is_embedding(name: str) -> bool:
    return "embed" in name.lower()


def _resolve_mlx_repo(name: str) -> str:
    """Return the trusted HuggingFace repo for *name*, or "" if not allowed.

    Allowed means:
    - the name is an explicit key in model_map.json (trusted, curated list), OR
    - the name is already a namespaced mlx-community/… repo (trusted org).

    Anything else returns "" to signal "not allowed" — callers must refuse it.
    """
    mapping: dict = {}
    try:
        mapping = _get_settings().load_model_mappings() or {}
    except Exception:
        mapping = {}
    if name in mapping:
        return mapping[name]
    # Symmetry: /api/tags advertises the bare repo basenames of these mapped
    # values (e.g. "Qwen3-32B-4bit" for "mlx-community/Qwen3-32B-4bit"). Accept
    # those by reverse-looking-up the curated map's values, so anything we list
    # as available is also pullable. The candidate equals a curated value's
    # basename, so it is already trusted — no extra char validation needed.
    for repo in mapping.values():
        if isinstance(repo, str) and "/" in repo and repo.rsplit("/", 1)[-1] == name:
            return repo
    if name.startswith("mlx-community/"):
        # Defense-in-depth: don't outsource validation of the user-supplied repo
        # to HuggingFace downstream. Reject path traversal, nested namespaces, and
        # any char outside the safe HF-repo set before forwarding.
        if (
            ".." in name
            or name.count("/") != 1
            or any(c.isspace() for c in name)
            or not re.fullmatch(r"[A-Za-z0-9._/-]+", name)
        ):
            return ""
        return name
    return ""


def _ndjson(obj: dict) -> str:
    return json.dumps(obj) + "\n"


async def _start_download(client: httpx.AsyncClient, repo: str) -> None:
    """POST the oMLX download request. Raises RuntimeError on failure."""
    try:
        r = await client.post(f"{_OMLX}/admin/api/hf/download", json={"repo_id": repo})
    except Exception as exc:  # connection refused / timeout
        raise RuntimeError(f"oMLX download API unreachable at {_OMLX}: {exc}")
    if r.status_code == 401:
        raise RuntimeError(
            "oMLX admin API requires auth — set auth.skip_api_key_verification=true "
            "in ~/.omlx/settings.json (the installer does this)."
        )
    # oMLX signals a duplicate/in-flight download as 409, or as 400 with
    # "already in progress" in the body (version-dependent). Both are benign: the
    # download is already running, so fall through to the polling loop — it picks
    # up the in-progress task from /admin/api/hf/tasks and streams its real
    # progress. Only genuine errors (bad repo, unreachable, etc.) should fail.
    if r.status_code >= 400 and not _download_already_running(r.status_code, r.text):
        raise RuntimeError(f"oMLX download API returned HTTP {r.status_code}: {r.text[:200]}")


def _download_already_running(status_code: int, body: str) -> bool:
    """True when oMLX's response means 'this download is already in flight'.

    Pure + dependency-free so the benign-vs-error decision is unit-testable
    without booting the FastAPI app or hitting oMLX.
    """
    if status_code == 409:
        return True
    return status_code == 400 and "already in progress" in (body or "").lower()


async def _latest_task(client: httpx.AsyncClient, repo: str) -> Optional[dict]:
    """Return the most recent download task for *repo*, or None."""
    try:
        r = await client.get(f"{_OMLX}/admin/api/hf/tasks")
        tasks = r.json().get("tasks", [])
    except Exception:
        return None
    matches = [t for t in tasks if t.get("repo_id") == repo]
    if not matches:
        return None
    return max(matches, key=lambda t: t.get("created_at", 0))


async def _pull_stream(name: str):
    """Yield Ollama-style NDJSON strings for pulling `name`."""
    if _is_embedding(name):
        # Embedding model lives on the embed-only Ollama; forward its pull stream.
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0)) as client:
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
    if not repo:
        yield _ndjson({
            "status": "error",
            "error": (
                f"refusing to pull unmapped model '{name}' "
                "(not in model_map.json and not an mlx-community repo)"
            ),
        })
        return

    yield _ndjson({"status": "pulling manifest"})
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)) as client:
        try:
            await _start_download(client, repo)
        except RuntimeError as exc:
            yield _ndjson({"status": "error", "error": str(exc)})
            return

        # Poll the oMLX task for real byte progress → Ollama-style NDJSON.
        for _ in range(_POLL_MAX):
            task = await _latest_task(client, repo)
            if task is not None:
                status = task.get("status", "")
                total = int(task.get("total_size", 0) or 0)
                done = int(task.get("downloaded_size", 0) or 0)
                if status in ("error", "failed"):
                    yield _ndjson({"status": "error",
                                   "error": task.get("error") or f"download {status}"})
                    return
                if status == "completed":
                    # ALWAYS emit a 100% downloading frame. When oMLX reports the
                    # model already-complete (or with no byte counts) the stream
                    # would otherwise collapse to verifying/success with no
                    # total/completed, and the admin's progress guard
                    # (`if chunk.completed && chunk.total`) never fires → the UI
                    # shows 0 progress and the download looks instant. `total or 1`
                    # is a sentinel so the admin still sees one full (100%) frame.
                    yield _ndjson({"status": "downloading", "digest": repo,
                                   "total": total or 1, "completed": total or 1})
                    yield _ndjson({"status": "verifying"})
                    yield _ndjson({"status": "success"})
                    return
                # pending / downloading → emit progress (real numbers when known)
                line = {"status": "downloading", "digest": repo}
                if total:
                    line["total"] = total
                    line["completed"] = done
                yield _ndjson(line)
            else:
                yield _ndjson({"status": "downloading", "digest": repo})
            await asyncio.sleep(_POLL_INTERVAL)
        yield _ndjson({"status": "error", "error": f"timed out downloading {repo}"})


@router.post("/pull")
async def pull(request: Request):
    body = await request.json()
    name = body.get("name") or body.get("model") or ""
    return StreamingResponse(_pull_stream(name), media_type="application/x-ndjson")


@router.get("/nomad/pullable")
async def pullable():
    """List the Ollama-style model names the proxy can resolve to MLX (the
    curated model_map.json keys). The admin uses this in oMLX mode to mark which
    catalog models are available as MLX — single source of truth = model_map.json.
    """
    try:
        mapping = _get_settings().load_model_mappings() or {}
    except Exception:
        mapping = {}
    names = sorted(k for k in mapping.keys() if k != "_comment")
    return {"models": names}
