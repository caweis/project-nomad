"""Regression: /api/tags MUST union in the embed-only Ollama's models.

The admin's RAG verification does:

    getModels().find(m => m.name === 'nomic-embed-text:v1.5')

That model lives on the embed-only Ollama (:11435), not oMLX, so without unioning
the embed Ollama's /api/tags into list_models the verification never finds it.
These tests pin (1) the embed model gets merged in when NOMAD_EMBED_URL is set, and
(2) an embed-Ollama failure never breaks the oMLX listing.
"""
import os
import sys
from pathlib import Path

import httpx
import pytest

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"
from src.routers import models as models_router  # noqa: E402


class _FakeURL:
    def __init__(self, path):
        self.path = path


class _FakeState:
    request_id = "test-req"


class _FakeReq:
    def __init__(self, path="/api/tags"):
        self.url = _FakeURL(path)
        self.state = _FakeState()


_OMLX_MODELS = {
    "object": "list",
    "data": [
        {
            "id": "Meta-Llama-3.1-8B-Instruct-4bit",
            "object": "model",
            "created": 0,
            "owned_by": "mlx-community",
        }
    ],
}

_EMBED_TAGS = {
    "models": [
        {
            "name": "nomic-embed-text:v1.5",
            "model": "nomic-embed-text:v1.5",
            "modified_at": "2024-01-01T00:00:00Z",
            "size": 274302450,
            "digest": "sha256:abc123",
            "details": {"family": "nomic-bert"},
        }
    ]
}


def _names(payload):
    import json

    return {m["name"] for m in json.loads(bytes(payload.body))["models"]}


@pytest.mark.asyncio
async def test_tags_unions_embed_model(monkeypatch):
    """When NOMAD_EMBED_URL is set and the embed Ollama returns a model, list_models
    includes it alongside the oMLX chat models."""

    async def fake_get(self, url, **kw):
        if "/api/tags" in url:
            return httpx.Response(200, json=_EMBED_TAGS, request=httpx.Request("GET", url))
        return httpx.Response(200, json=_OMLX_MODELS, request=httpx.Request("GET", url))

    monkeypatch.setattr(models_router.httpx.AsyncClient, "get", fake_get)
    resp = await models_router.list_models(_FakeReq())
    names = _names(resp)
    assert "Meta-Llama-3.1-8B-Instruct-4bit" in names  # oMLX chat model preserved
    assert "nomic-embed-text:v1.5" in names  # embed model unioned in


@pytest.mark.asyncio
async def test_tags_survives_embed_failure(monkeypatch):
    """An embed-Ollama failure must NOT break the oMLX listing — the union is skipped
    and the oMLX models still come through."""

    async def fake_get(self, url, **kw):
        if "/api/tags" in url:
            raise httpx.ConnectError("refused", request=httpx.Request("GET", url))
        return httpx.Response(200, json=_OMLX_MODELS, request=httpx.Request("GET", url))

    monkeypatch.setattr(models_router.httpx.AsyncClient, "get", fake_get)
    resp = await models_router.list_models(_FakeReq())
    names = _names(resp)
    assert "Meta-Llama-3.1-8B-Instruct-4bit" in names  # oMLX listing intact
    assert "nomic-embed-text:v1.5" not in names  # embed union cleanly skipped


@pytest.mark.asyncio
async def test_tags_no_union_when_env_unset(monkeypatch):
    """With NOMAD_EMBED_URL unset, behavior is unchanged: oMLX-only, no embed query."""
    monkeypatch.delenv("NOMAD_EMBED_URL", raising=False)
    called = {"embed": False}

    async def fake_get(self, url, **kw):
        if "/api/tags" in url:
            called["embed"] = True
        return httpx.Response(200, json=_OMLX_MODELS, request=httpx.Request("GET", url))

    monkeypatch.setattr(models_router.httpx.AsyncClient, "get", fake_get)
    resp = await models_router.list_models(_FakeReq())
    names = _names(resp)
    assert "Meta-Llama-3.1-8B-Instruct-4bit" in names
    assert called["embed"] is False  # no embed query attempted


# --- Installed-indicator regression: reverse-map oMLX id -> Ollama tag ----------
# The admin compares installed names against Ollama-style catalog tags
# (e.g. "qwen3:30b-a3b"). oMLX serves bare MLX repo basenames
# (e.g. "Qwen3-30B-A3B-4bit-DWQ"), so /api/tags must reverse-look-up each id
# through model_map.json and advertise the Ollama tag — else nothing shows
# installed. Unmapped ids fall back to the raw id.


class _StubSettings:
    DISABLE_SSL_VERIFICATION = False
    REQUEST_TIMEOUT = 30
    OPENAI_API_BASE_URL = "http://127.0.0.1:8000/v1"
    OPENAI_API_KEY = "x"
    _MAP = {
        "_comment": "ignored",
        "llama3.1:8b": "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit",
        "qwen3:30b-a3b": "mlx-community/Qwen3-30B-A3B-4bit-DWQ",
    }

    def load_model_mappings(self):
        return dict(self._MAP)


@pytest.mark.asyncio
async def test_tags_advertises_ollama_tag_for_mapped_id(monkeypatch):
    monkeypatch.delenv("NOMAD_EMBED_URL", raising=False)
    monkeypatch.setattr(models_router, "settings", _StubSettings())

    omlx = {
        "object": "list",
        "data": [
            {"id": "Meta-Llama-3.1-8B-Instruct-4bit", "created": 0, "owned_by": "mlx-community"},
            {"id": "Qwen3-30B-A3B-4bit-DWQ", "created": 0, "owned_by": "mlx-community"},
            {"id": "Some-Unmapped-Repo-4bit", "created": 0, "owned_by": "mlx-community"},
        ],
    }

    async def fake_get(self, url, **kw):
        return httpx.Response(200, json=omlx, request=httpx.Request("GET", url))

    monkeypatch.setattr(models_router.httpx.AsyncClient, "get", fake_get)
    resp = await models_router.list_models(_FakeReq())
    names = _names(resp)
    assert "llama3.1:8b" in names  # mapped basename -> Ollama tag
    assert "qwen3:30b-a3b" in names  # mapped basename -> Ollama tag
    assert "Some-Unmapped-Repo-4bit" in names  # unmapped id falls back to raw id
    assert "Meta-Llama-3.1-8B-Instruct-4bit" not in names  # raw mapped id NOT advertised


@pytest.mark.asyncio
async def test_tags_falls_back_to_raw_id_when_map_empty(monkeypatch):
    """No mapping (e.g. MODEL_MAPPING_FILE unset) -> raw oMLX ids, unchanged."""
    monkeypatch.delenv("NOMAD_EMBED_URL", raising=False)

    class _EmptySettings(_StubSettings):
        def load_model_mappings(self):
            return {}

    monkeypatch.setattr(models_router, "settings", _EmptySettings())

    async def fake_get(self, url, **kw):
        return httpx.Response(200, json=_OMLX_MODELS, request=httpx.Request("GET", url))

    monkeypatch.setattr(models_router.httpx.AsyncClient, "get", fake_get)
    resp = await models_router.list_models(_FakeReq())
    names = _names(resp)
    assert "Meta-Llama-3.1-8B-Instruct-4bit" in names  # raw id preserved
