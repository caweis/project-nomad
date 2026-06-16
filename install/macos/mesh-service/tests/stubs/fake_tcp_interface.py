"""A high-fidelity stand-in for meshtastic.tcp_interface.TCPInterface (2.7.9).

Modeled against the INSTALLED meshtastic source (not a prose summary), so the
adapter integration tests exercise the real receive/send/ack contract with no
radio and no socket:

* Constructor mirrors TCPInterface(hostname, ..., portNumber=4403) and opens NO
  socket (self.socket stays None).
* getMyNodeInfo() returns a dict shaped like the real one — {"num", "user": {"id"}}
  — whose user.id is a stable `!hexid`, the way the adapter learns our_node_id.
* sendText(text, destinationId, wantAck, ..., onResponse, channelIndex) records the
  call and, when wantAck and onResponse are given, delivers a ROUTING_APP response
  packet to onResponse, exactly as _handlePacketFromRadio routes an ack/nak. The
  ack_mode selects 'ack' (errorReason NONE), 'nak' (an error reason), or 'withhold'
  (never call back — models a delivery timeout).
* emit_text(...) publishes a TEXT_MESSAGE_APP packet on the real topic
  `meshtastic.receive.text` through the real `pubsub` broker with the real
  packet=/interface= kwargs and packet dict shape (from/to/fromId/toId/decoded).

Call pub.unsubAll() in tearDown to stop global-broker bleed between tests.
"""

from __future__ import annotations

from collections.abc import Callable

from pubsub import pub

DEFAULT_TCP_PORT = 4403

# The meshtastic broadcast sentinel (meshtastic.BROADCAST_ADDR) — channel messages
# are addressed to "^all".
BROADCAST_ADDR = "^all"


class FakeTCPInterface:
    def __init__(
        self,
        hostname: str,
        debugOut=None,
        noProto: bool = False,
        connectNow: bool = True,
        portNumber: int = DEFAULT_TCP_PORT,
        noNodes: bool = False,
        timeout: int = 300,
        *,
        our_node_id: str = "!aabbccdd",
        ack_mode: str = "ack",
    ):
        # Mirror the real TCPInterface attributes the adapter / library touch.
        self.hostname = hostname
        self.portNumber = portNumber
        self.noProto = noProto
        self.debugOut = debugOut
        self.noNodes = noNodes
        self.socket = None  # never opened — the whole point of the stub

        self.our_node_id = our_node_id
        self._our_node_num = 0xAABBCCDD
        self._ack_mode = ack_mode

        #: Every sendText call, in order — the integration tests' assertion surface.
        self.sent: list[dict] = []
        #: Monotonic-ish id generator for sent packets (mirrors meshPacket.id).
        self._next_id = 1000

    # --- real TCPInterface surface --------------------------------------------
    def getMyNodeInfo(self) -> dict:
        """Shaped like the real getMyNodeInfo() return — node dict with a user.id !hexid."""
        return {"num": self._our_node_num, "user": {"id": self.our_node_id}}

    @property
    def myInfo(self):
        class _MyInfo:
            my_node_num = self._our_node_num

        return _MyInfo()

    def sendText(
        self,
        text: str,
        destinationId: str = BROADCAST_ADDR,
        wantAck: bool = False,
        wantResponse: bool = False,
        onResponse: Callable[[dict], None] | None = None,
        channelIndex: int = 0,
        **kwargs,
    ) -> dict:
        """Record the send and (when reliable) deliver a ROUTING ack to onResponse."""
        packet_id = self._next_id
        self._next_id += 1
        self.sent.append(
            {
                "id": packet_id,
                "text": text,
                "destinationId": destinationId,
                "wantAck": wantAck,
                "channelIndex": channelIndex,
            }
        )
        if wantAck and onResponse is not None and self._ack_mode != "withhold":
            error_reason = "NONE" if self._ack_mode == "ack" else "NO_RESPONSE"
            onResponse(self._routing_packet(packet_id, destinationId, error_reason))
        return {"id": packet_id}

    def close(self) -> None:
        self.socket = None

    # --- test driving ---------------------------------------------------------
    def emit_text(
        self,
        text: str,
        *,
        from_id: str,
        to_id: str,
        channel: int = 0,
    ) -> None:
        """Publish an inbound text packet on the real `meshtastic.receive.text` topic.

        Matches _handlePacketFromRadio's published shape so the adapter's real
        PyPubSub subscriber receives exactly what the library would hand it.
        """
        packet = {
            "from": self._id_to_num(from_id),
            "to": self._id_to_num(to_id),
            "fromId": from_id,
            "toId": to_id,
            "channel": channel,
            "decoded": {
                "portnum": "TEXT_MESSAGE_APP",
                "payload": text.encode("utf-8"),
                "text": text,
            },
        }
        pub.sendMessage("meshtastic.receive.text", packet=packet, interface=self)

    # --- helpers --------------------------------------------------------------
    def _routing_packet(self, request_id: int, dest_id: str, error_reason: str) -> dict:
        return {
            "from": self._id_to_num(dest_id),
            "to": self._our_node_num,
            "fromId": dest_id,
            "toId": self.our_node_id,
            "decoded": {
                "portnum": "ROUTING_APP",
                "requestId": request_id,
                "routing": {"errorReason": error_reason},
            },
        }

    @staticmethod
    def _id_to_num(node_id: str) -> int:
        if node_id in (BROADCAST_ADDR, "^local"):
            return 0xFFFFFFFF
        try:
            return int(node_id.lstrip("!"), 16)
        except ValueError:
            return 0
