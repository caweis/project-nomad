"""The responder loop.

Inbound message -> trigger gate -> rate limit -> safety route (canned or AI) ->
sanitize -> chunk -> send. The AI is reached through an injected AIClient, so the
whole loop runs in tests against a mock adapter + mock AI, with no radio and no
model. A first-contact disclaimer is sent once per known node.

The research is firm that the LLM must not be called on the radio's receive path;
in production `handle_message` runs on a single worker draining a queue (wired in
app.py). It is written to be called directly so it can be unit-tested.
"""

from __future__ import annotations

import logging
from typing import Protocol

from .adapter import Identity, IncomingMessage, MeshAdapter
from .chunker import chunk_message
from .rate_limit import RateLimiter
from .safety import FIRST_CONTACT_DISCLAIMER, route_query, sanitize_model_output
from .trigger import DEFAULT_TRIGGER, should_respond

logger = logging.getLogger(__name__)

_AI_UNAVAILABLE = "Not sure - the assistant is unavailable right now."
_NO_ANSWER = "Not sure - no answer. Try rephrasing."


class AIClient(Protocol):
    def ask(self, query: str) -> str: ...


class Responder:
    def __init__(
        self,
        adapter: MeshAdapter,
        ai: AIClient,
        rate_limiter: RateLimiter | None = None,
        *,
        our_node_id: str | None = None,
        trigger: str = DEFAULT_TRIGGER,
        send_disclaimer: bool = True,
    ):
        self._adapter = adapter
        self._ai = ai
        self._rate = rate_limiter or RateLimiter()
        self._our_node_id = our_node_id
        self._trigger = trigger
        self._send_disclaimer = send_disclaimer
        self._greeted: set[str] = set()

    def start(self) -> None:
        self._adapter.on_message(self.handle_message)

    def handle_message(self, message: IncomingMessage) -> list[str]:
        """Process one inbound message; return the parts actually sent (for tests)."""
        respond, query = should_respond(
            message, our_node_id=self._our_node_id, trigger=self._trigger
        )
        if not respond:
            return []

        node_key = message.sender.node_id or f"anon:{message.channel or 'broadcast'}"
        if not self._rate.allow(node_key):
            logger.info("rate-limited %s", node_key)
            return []

        reply_to = self._reply_target(message)
        sent: list[str] = []

        # First-contact disclaimer, once per known node.
        if (
            self._send_disclaimer
            and message.sender.node_id is not None
            and node_key not in self._greeted
        ):
            self._greeted.add(node_key)
            self._adapter.send_text(reply_to, FIRST_CONTACT_DISCLAIMER)
            sent.append(FIRST_CONTACT_DISCLAIMER)

        reply = self._answer(query)
        max_bytes = getattr(self._adapter, "max_text_bytes", 200)
        for part in chunk_message(reply, max_bytes=max_bytes):
            self._adapter.send_text(reply_to, part)
            sent.append(part)
        return sent

    def _answer(self, query: str) -> str:
        # Highest-stakes queries bypass the AI for a fixed, vetted message.
        canned = route_query(query)
        if canned is not None:
            return canned
        try:
            reply = sanitize_model_output(self._ai.ask(query))
        except Exception:
            logger.exception("AI call failed")
            return _AI_UNAVAILABLE
        return reply or _NO_ANSWER

    def _reply_target(self, message: IncomingMessage) -> Identity:
        # DM-preferred so the bridge never congests the primary channel: reply to a
        # known sender directly; fall back to the channel only when the sender is
        # anonymous (e.g. a MeshCore channel message carries no sender id).
        if message.sender.is_known:
            return message.sender
        return Identity(protocol=message.sender.protocol, node_id=None, name=message.channel)
