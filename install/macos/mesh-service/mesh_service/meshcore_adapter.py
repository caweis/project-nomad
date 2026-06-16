"""MeshCore adapter — SCAFFOLD ONLY (P3). Not production.

`meshcore-py` is self-classified Beta: a point release broke message-receive (#81)
and it carries a root-logger hygiene smell (#58). So this adapter refuses to
construct unless the operator explicitly opts in with MESH_ENABLE_MESHCORE=1, and
the real async wiring is left as a documented contract — NOT called code. The
capability descriptors below come from the research and let the rest of the system
reason about MeshCore (identity-by-pubkey-prefix, conservative payload, ack-by-
expected-ack) without a working adapter.

Implementation contract (when P3 is actually built — do NOT call any of this yet):

  Concurrency
    MeshCore-py is asyncio-native. Run it on its OWN dedicated asyncio loop thread;
    hand inbound messages across the thread<->loop boundary via a thread-safe queue.
    NEVER call a MeshCore async command from a Meshtastic PyPubSub callback.

  Connect
    mc = await MeshCore.create_tcp(host, port)   # port is REQUIRED, no default
    await mc.start_auto_message_fetching()       # begin receiving
    Gate every send on mc.is_connected; enable auto_reconnect.

  Send / result handling
    result = await mc.commands.send_msg(contact, text)
    if result.is_error(): ...                     # branch on is_error(), not truthiness
    Delivery is tracked via an EXPECTED_ACK event (ack_support below), not a bool.

  Identity
    DMs are addressed by a 6-byte pubkey prefix (collision-prone); channel messages
    carry NO sender id. Model "unknown/ambiguous sender" as a first-class state
    (Identity.node_id is None) — already supported by the shared Identity type.

  Payload
    MeshCore publishes no fixed payload number; enforce the conservative cap below
    with an explicit truncate/fragment/reject policy (the chunker already byte-caps).

  Logging hygiene
    Re-assert our logging config on import, or isolate MeshCore in the worker, so its
    root-logger writes don't bleed into the service's logs (#58).
"""

from __future__ import annotations

import os

from .adapter import Identity, MeshAdapter, MessageHandler

_OPT_IN_ENV = "MESH_ENABLE_MESHCORE"
_GUARD_MESSAGE = (
    "MeshCore adapter is experimental — not production; see P3. "
    f"Set {_OPT_IN_ENV}=1 to construct it knowingly."
)


class MeshCoreAdapter(MeshAdapter):
    # Capability descriptors (research-derived). Read at runtime, never flattened.
    identity_kind = "pubkey_prefix"
    #: MeshCore publishes no fixed number; 130 is a conservative cap under the
    #: ~133-char / 163-byte datagram limit, leaving room for the chunk suffix.
    max_text_bytes = 130
    #: MeshCore reports delivery via an expected-ack event.
    ack_support = True

    def __init__(self, host: str, *, port: int = 4000):
        if os.environ.get(_OPT_IN_ENV) != "1":
            raise NotImplementedError(_GUARD_MESSAGE)
        self._host = host
        self._port = port
        self._handler: MessageHandler | None = None

    def connect(self) -> None:  # pragma: no cover - scaffold, see module contract
        raise NotImplementedError(_GUARD_MESSAGE)

    def send_text(self, to: Identity, body: str) -> None:  # pragma: no cover - scaffold
        raise NotImplementedError(_GUARD_MESSAGE)

    def on_message(self, handler: MessageHandler) -> None:
        # Registration is safe to record even in the scaffold; the receive loop that
        # would invoke it is what P3 still has to build (see module contract).
        self._handler = handler

    def list_contacts(self) -> list[Identity]:  # pragma: no cover - scaffold
        raise NotImplementedError(_GUARD_MESSAGE)
