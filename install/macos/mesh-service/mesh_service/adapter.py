"""The narrow MeshAdapter interface, shared by every radio protocol.

Deliberately narrow (research verdict): each protocol gets its own explicit
implementation, and the differences that leak — identity model, payload size, ACK
semantics — are surfaced as capability descriptors rather than flattened. P0 ships
only the interface + a mock; Meshtastic and MeshCore implementations come later.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Identity:
    """Who a message is from / to, across protocols.

    Meshtastic has a stable `!hexid`; MeshCore identifies DMs by a collision-prone
    pubkey prefix and carries NO sender id on channel messages — so node_id is
    optional and "unknown sender" is a first-class state.
    """

    protocol: str
    node_id: str | None = None
    name: str | None = None

    @property
    def is_known(self) -> bool:
        return self.node_id is not None


@dataclass(frozen=True)
class IncomingMessage:
    text: str
    sender: Identity
    is_direct: bool  # True = DM to us; False = channel / broadcast
    channel: str | None = None


# Called with each inbound message. Implementations must invoke it OFF the receive
# path's hot loop is the caller's concern; the responder never blocks here.
MessageHandler = Callable[[IncomingMessage], None]


class MeshAdapter(ABC):
    """A radio the bridge can talk through. Capability descriptors are read at
    runtime, never hardcoded, because they differ per protocol and per node."""

    #: 'node_id' (Meshtastic) or 'pubkey_prefix' (MeshCore).
    identity_kind: str = "node_id"
    #: Usable payload in bytes — queried, not assumed (MeshCore publishes no fixed number).
    max_text_bytes: int = 200
    #: Whether the protocol reports delivery ACKs.
    ack_support: bool = False

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def send_text(self, to: Identity, body: str) -> None:
        """Send one already-chunked part to a node (DM) or channel."""

    @abstractmethod
    def on_message(self, handler: MessageHandler) -> None:
        """Register the inbound-message callback."""

    @abstractmethod
    def list_contacts(self) -> list[Identity]: ...
