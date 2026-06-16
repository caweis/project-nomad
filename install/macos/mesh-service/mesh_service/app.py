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
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from .adapter import Identity, IncomingMessage
from .ai_client import OllamaAIClient
from .config import load_config
from .mock_adapter import MockAdapter
from .rate_limit import RateLimiter
from .responder import Responder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mesh")

config = load_config()
adapter = MockAdapter()
ai = OllamaAIClient(
    config.ollama_url,
    config.model,
    timeout_s=config.request_timeout_s,
    max_answer_chars=config.max_answer_chars,
)
rate = RateLimiter(config.per_node_per_min, config.global_per_min)
responder = Responder(adapter, ai, rate, our_node_id=config.our_node_id, trigger=config.trigger)

_inbox: "queue.Queue[IncomingMessage | None]" = queue.Queue()

# Receive path: enqueue only — never call the AI here.
adapter.on_message(_inbox.put)


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


@asynccontextmanager
async def lifespan(_: FastAPI):
    worker = threading.Thread(target=_worker, name="mesh-responder", daemon=True)
    worker.start()
    adapter.connect()
    logger.info("mesh bridge up: adapter=mock model=%s ai=%s", config.model, config.ollama_url)
    yield
    _inbox.put(None)


app = FastAPI(title="NOMAD Mesh Bridge", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "adapter": "mock",
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
    _inbox.put(
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
    """Outbound send to the mesh (alerts / admin console use this)."""
    adapter.send_text(Identity("mock", req.to, req.to), req.body)
    return {"sent": True}


@app.get("/sent")
def sent() -> dict:
    """What the bridge has sent so far (mock adapter only — for the smoke test)."""
    return {"sent": [{"to": to.node_id, "body": body} for to, body in adapter.sent]}
