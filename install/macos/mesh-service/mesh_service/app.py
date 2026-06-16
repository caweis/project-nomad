"""FastAPI app for the mesh bridge.

The adapter's receive callback only enqueues; a single worker thread drains the
queue and runs the responder (which calls the AI). This keeps the LLM off the
radio's receive path and serializes generation onto one local model — the
research's hard rules. P0 wires the MockAdapter so the whole service runs with no
radio; P1+ swaps in MeshtasticAdapter / MeshCoreAdapter behind the same interface.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from .adapter import Identity, IncomingMessage, MeshAdapter
from .ai_client import OllamaAIClient
from .config import Config, load_config
from .mock_adapter import MockAdapter
from .rate_limit import RateLimiter
from .responder import Responder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mesh")


def build_adapter(config: Config) -> MeshAdapter:
    """Select the mesh adapter from config. Default 'mock' needs no radio library;
    the 'meshtastic' branch imports the real adapter (and meshtastic) lazily, so
    importing app.py in mock mode never requires the radio lib."""
    if config.adapter_kind == "meshtastic":
        from .meshtastic_adapter import MeshtasticAdapter
        from .pacing import AirtimePacer

        return MeshtasticAdapter(
            config.meshtastic_host,
            port=config.meshtastic_port,
            pacer=AirtimePacer(),
        )
    return MockAdapter()


config = load_config()
adapter = build_adapter(config)
ai = OllamaAIClient(
    config.ollama_url,
    config.model,
    timeout_s=config.request_timeout_s,
    max_answer_chars=config.max_answer_chars,
)
rate = RateLimiter(config.per_node_per_min, config.global_per_min)
responder = Responder(adapter, ai, rate, our_node_id=config.our_node_id, trigger=config.trigger)

_inbox: "queue.Queue[IncomingMessage | None]" = queue.Queue()

# A bounded ring buffer of recent inbound + outbound messages for the admin console.
RECENT_MESSAGES_MAX = 200
recent_messages: "deque[dict]" = deque(maxlen=RECENT_MESSAGES_MAX)


def record_inbound(message: IncomingMessage) -> None:
    """Note an inbound message in the ring buffer AND enqueue it. This stays on the
    receive path's cheap side — it records and enqueues only, never the responder."""
    recent_messages.append(
        {
            "direction": "in",
            "node": message.sender.node_id,
            "text": message.text,
            "is_direct": message.is_direct,
            "channel": message.channel,
            "ts": time.time(),
        }
    )
    _inbox.put(message)


def record_outbound(to: str, body: str) -> None:
    recent_messages.append(
        {"direction": "out", "node": to, "text": body, "ts": time.time()}
    )


# Receive path: record + enqueue only — never call the AI here.
adapter.on_message(record_inbound)


def _worker() -> None:
    while True:
        message = _inbox.get()
        try:
            if message is None:
                return
            responder.handle_message(message)
        except Exception:
            logger.exception("responder failed")
        finally:
            _inbox.task_done()


_state = {"connected": False}


@asynccontextmanager
async def lifespan(_: FastAPI):
    worker = threading.Thread(target=_worker, name="mesh-responder", daemon=True)
    worker.start()
    adapter.connect()
    _state["connected"] = True
    logger.info(
        "mesh bridge up: adapter=%s model=%s ai=%s",
        config.adapter_kind,
        config.model,
        config.ollama_url,
    )
    yield
    _state["connected"] = False
    _inbox.put(None)


app = FastAPI(title="NOMAD Mesh Bridge", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "adapter": config.adapter_kind,
        "model": config.model,
        "ai_url": config.ollama_url,
    }


class InjectRequest(BaseModel):
    text: str
    sender: str = "!test"
    is_direct: bool = True
    channel: str | None = None


@app.post("/debug/inject")
def inject(req: InjectRequest) -> dict:
    """Push a synthetic inbound message through the loop (console + smoke tests)."""
    record_inbound(
        IncomingMessage(
            text=req.text,
            sender=Identity("mock", req.sender, req.sender),
            is_direct=req.is_direct,
            channel=req.channel,
        )
    )
    return {"queued": True}


class SendRequest(BaseModel):
    to: str
    body: str


@app.post("/send")
def send(req: SendRequest) -> dict:
    """The SINGLE outbound path to the mesh (alerts + admin console both use this).

    Routes through adapter.send_text, so it inherits the adapter's airtime pacing.
    Deliberately the only place that calls send_text from the HTTP surface — no
    second, unmetered send route."""
    adapter.send_text(Identity(config.adapter_kind, req.to, req.to), req.body)
    record_outbound(req.to, req.body)
    return {"sent": True}


@app.get("/status")
def status() -> dict:
    """Adapter kind, model, AI url, connection state, and the recent-message ring."""
    return {
        "adapter": config.adapter_kind,
        "model": config.model,
        "ai_url": config.ollama_url,
        "connected": _state["connected"],
        "recent": list(recent_messages),
    }


@app.get("/messages")
def messages() -> dict:
    """Recent inbound + outbound messages (bounded ring buffer) for the console."""
    return {"messages": list(recent_messages)}


@app.get("/sent")
def sent() -> dict:
    """What the bridge has sent so far (mock adapter only — for the smoke test)."""
    return {"sent": [{"to": to.node_id, "body": body} for to, body in adapter.sent]}
