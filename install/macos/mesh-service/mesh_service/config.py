"""Service configuration from environment variables.

The AI endpoint mirrors the rest of NOMAD: `NOMAD_OLLAMA_URL` points at the
OpenAI/Ollama-compatible API on the host (`host.docker.internal:11434` Ollama,
`:11436` oMLX), reached over the internal Docker network — not the LAN.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    ollama_url: str
    model: str
    http_host: str
    http_port: int
    trigger: str
    per_node_per_min: int
    global_per_min: int
    our_node_id: str | None
    request_timeout_s: float
    max_answer_chars: int
    adapter_kind: str
    meshtastic_host: str
    meshtastic_port: int


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def load_config() -> Config:
    return Config(
        ollama_url=os.environ.get("NOMAD_OLLAMA_URL", "http://host.docker.internal:11434"),
        model=os.environ.get("NOMAD_MESH_MODEL", "llama3.2:1b"),
        http_host=os.environ.get("MESH_HTTP_HOST", "0.0.0.0"),
        http_port=_int("MESH_HTTP_PORT", 8600),
        trigger=os.environ.get("MESH_TRIGGER", "@ai"),
        per_node_per_min=_int("MESH_PER_NODE_PER_MIN", 3),
        global_per_min=_int("MESH_GLOBAL_PER_MIN", 20),
        our_node_id=os.environ.get("MESH_OUR_NODE_ID") or None,
        request_timeout_s=_float("MESH_AI_TIMEOUT_S", 30.0),
        max_answer_chars=_int("MESH_MAX_ANSWER_CHARS", 600),
        # 'mock' (default — no radio, no radio lib) or 'meshtastic' (real adapter).
        adapter_kind=os.environ.get("MESH_ADAPTER", "mock"),
        meshtastic_host=os.environ.get("MESH_RADIO_HOST", "host.docker.internal"),
        meshtastic_port=_int("MESH_RADIO_PORT", 4403),
    )
