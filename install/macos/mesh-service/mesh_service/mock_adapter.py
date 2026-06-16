"""In-memory mock adapter — lets the whole receive->AI->chunk->send loop run and
be tested with no radio hardware (the foundation of P0)."""

from __future__ import annotations

from .adapter import Identity, IncomingMessage, MeshAdapter, MessageHandler


class MockAdapter(MeshAdapter):
    identity_kind = "node_id"
    max_text_bytes = 200
    ack_support = False

    def __init__(self, contacts: list[Identity] | None = None):
        self._handler: MessageHandler | None = None
        self._contacts = contacts or []
        #: Every (to, body) the bridge sent, in order — the test assertion surface.
        self.sent: list[tuple[Identity, str]] = []
        self.connected = False

    def connect(self) -> None:
        self.connected = True

    def send_text(self, to: Identity, body: str) -> None:
        self.sent.append((to, body))

    def on_message(self, handler: MessageHandler) -> None:
        self._handler = handler

    def list_contacts(self) -> list[Identity]:
        return list(self._contacts)

    # --- test helpers ---------------------------------------------------------
    def inject(self, message: IncomingMessage) -> None:
        """Simulate an inbound radio message reaching the registered handler."""
        if self._handler is None:
            raise RuntimeError("no message handler registered")
        self._handler(message)

    @property
    def sent_bodies(self) -> list[str]:
        return [body for _, body in self.sent]
