"""Meshtastic implementation of the MeshAdapter interface (over TCP).

Verified against meshtastic-py 2.7.9's real surface:

* TCPInterface(hostname, ..., portNumber=4403) is built LAZILY in connect() — the
  library is imported inside connect() too, so importing this module (and app.py in
  mock mode) needs no radio library installed.
* Our own !hexid is learned once from getMyNodeInfo()["user"]["id"] and stored, so
  the responder's loop guard and the DM/channel decision have a stable identity.
* Inbound text arrives via PyPubSub on "meshtastic.receive.text"; _on_receive maps
  the packet dict to an IncomingMessage and calls ONLY the registered handler. The
  handler enqueues — it never reaches the LLM on the receive path (the research's
  hard invariant). PyPubSub holds listeners weakly, so we keep a strong reference
  to the bound subscriber or the subscription would be GC'd and silently die.
* send_text sends one already-chunked part. To a known node it sends wantAck=True
  with an onResponse callback that sets a threading.Event; the AirtimePacer waits
  for that ACK or times out — a NAK or a missing ACK both fall through without
  hanging. A channel/anonymous reply can't be per-node ACK-tracked, so it broadcasts
  and paces with the fixed fallback delay instead.
"""

from __future__ import annotations

import logging
import threading

from .adapter import Identity, MeshAdapter, MessageHandler
from .adapter import IncomingMessage
from .pacing import AirtimePacer

logger = logging.getLogger(__name__)

RECEIVE_TEXT_TOPIC = "meshtastic.receive.text"
BROADCAST_ADDR = "^all"


def _default_interface_factory(**kwargs):
    # Imported lazily so the module imports without the radio library present.
    from meshtastic.tcp_interface import TCPInterface

    return TCPInterface(**kwargs)


class MeshtasticAdapter(MeshAdapter):
    identity_kind = "node_id"
    max_text_bytes = 200
    ack_support = True

    def __init__(
        self,
        host: str,
        *,
        port: int = 4403,
        pacer: AirtimePacer | None = None,
        interface_factory=_default_interface_factory,
    ):
        self._host = host
        self._port = port
        self._pacer = pacer or AirtimePacer()
        self._interface_factory = interface_factory
        self._iface = None
        self._handler: MessageHandler | None = None
        self.our_node_id: str | None = None
        # Strong ref to the bound subscriber — PyPubSub keeps only a weak one.
        self._subscriber = self._on_receive

    def connect(self) -> None:
        from pubsub import pub

        self._iface = self._interface_factory(hostname=self._host, portNumber=self._port)
        info = self._iface.getMyNodeInfo()
        if info:
            self.our_node_id = (info.get("user") or {}).get("id")
        pub.subscribe(self._subscriber, RECEIVE_TEXT_TOPIC)
        logger.info("meshtastic adapter connected: host=%s our=%s", self._host, self.our_node_id)

    def on_message(self, handler: MessageHandler) -> None:
        self._handler = handler

    def _on_receive(self, packet: dict, interface=None) -> None:
        """Map a meshtastic packet to an IncomingMessage and hand it to the handler.

        Deliberately cheap: it never calls the AI. It only builds the message and
        invokes the registered handler (which, in app.py, just enqueues).
        """
        if self._handler is None:
            return
        decoded = packet.get("decoded") or {}
        text = decoded.get("text")
        if text is None:
            return  # non-text or undecodable payload — not ours to answer
        from_id = packet.get("fromId")
        to_id = packet.get("toId")
        is_direct = self.our_node_id is not None and to_id == self.our_node_id
        channel = packet.get("channel")
        message = IncomingMessage(
            text=text,
            sender=Identity(protocol="meshtastic", node_id=from_id, name=from_id),
            is_direct=is_direct,
            channel=str(channel) if channel is not None else None,
        )
        self._handler(message)

    def send_text(self, to: Identity, body: str) -> None:
        if self._iface is None:
            raise RuntimeError("send_text before connect()")
        if to.is_known:
            self._send_reliable(to.node_id, body)
        else:
            # No per-node identity (channel fallback) — broadcast, can't ACK-track.
            self._iface.sendText(body, destinationId=BROADCAST_ADDR, wantAck=False)
            self._pacer.pace_fallback()

    def _send_reliable(self, node_id: str, body: str) -> None:
        acked = threading.Event()

        def on_response(_packet: dict) -> None:
            # Fired for both ACK (routing.errorReason == NONE) and NAK; either way the
            # exchange is over. We set on ACK so the pacer reports delivered; a NAK or
            # a withheld ack leaves the event clear and the pacer times out — never hangs.
            routing = (_packet.get("decoded") or {}).get("routing") or {}
            if routing.get("errorReason", "NONE") == "NONE":
                acked.set()

        self._iface.sendText(
            body,
            destinationId=node_id,
            wantAck=True,
            onResponse=on_response,
            onResponseAckPermitted=True,
        )
        self._pacer.wait_for_ack_or_timeout(acked)

    def list_contacts(self) -> list[Identity]:
        nodes = getattr(self._iface, "nodes", None) or {}
        contacts: list[Identity] = []
        for node_id, node in nodes.items():
            name = ((node or {}).get("user") or {}).get("longName")
            contacts.append(Identity(protocol="meshtastic", node_id=node_id, name=name))
        return contacts
