"""MeshtasticAdapter unit tests, driven entirely by FakeTCPInterface (no radio).

Covers: connect() learns our !hexid + sets capability flags; the receive path maps
a meshtastic packet to IncomingMessage and ONLY calls the registered handler (never
the AI — the receive-path-cheap invariant); send_text paces on ACK / NAK / timeout
and never hangs; is_direct is computed from our node id.
"""

import threading
import unittest

from pubsub import pub

from mesh_service.adapter import Identity, IncomingMessage, MeshAdapter
from mesh_service.meshtastic_adapter import MeshtasticAdapter
from mesh_service.pacing import AirtimePacer
from tests.stubs.fake_tcp_interface import FakeTCPInterface

OUR = "!aabbccdd"


class SpyPacer(AirtimePacer):
    def __init__(self, **kw):
        super().__init__(sleep=lambda _dt: None, **kw)
        self.waits: list[bool] = []
        self.fallbacks = 0

    def wait_for_ack_or_timeout(self, ack_event: threading.Event) -> bool:
        result = super().wait_for_ack_or_timeout(ack_event)
        self.waits.append(result)
        return result

    def pace_fallback(self) -> None:
        self.fallbacks += 1


def make(ack_mode="ack", pacer=None):
    iface = FakeTCPInterface("radio.local", our_node_id=OUR, ack_mode=ack_mode)
    adapter = MeshtasticAdapter(
        "radio.local", pacer=pacer or SpyPacer(), interface_factory=lambda **kw: iface
    )
    return adapter, iface


class TestMeshtasticAdapter(unittest.TestCase):
    def tearDown(self):
        pub.unsubAll()

    def test_is_a_mesh_adapter(self):
        adapter, _ = make()
        self.assertIsInstance(adapter, MeshAdapter)

    def test_connect_learns_our_node_id_and_sets_capabilities(self):
        adapter, _ = make()
        adapter.connect()
        self.assertEqual(adapter.our_node_id, OUR)
        self.assertTrue(adapter.ack_support)

    def test_no_socket_or_interface_built_before_connect(self):
        built = []
        adapter = MeshtasticAdapter(
            "radio.local",
            pacer=SpyPacer(),
            interface_factory=lambda **kw: built.append(kw)
            or FakeTCPInterface("radio.local", our_node_id=OUR),
        )
        self.assertEqual(built, [])  # lazy: factory not called at construction

    def test_receive_maps_dm_to_incoming_message_and_calls_handler_only(self):
        adapter, iface = make()
        got: list[IncomingMessage] = []
        adapter.on_message(got.append)
        adapter.connect()
        iface.emit_text("how do I purify water", from_id="!bob", to_id=OUR)
        self.assertEqual(len(got), 1)
        msg = got[0]
        self.assertEqual(msg.text, "how do I purify water")
        self.assertEqual(msg.sender.node_id, "!bob")
        self.assertEqual(msg.sender.protocol, "meshtastic")
        self.assertTrue(msg.is_direct)  # addressed to our node id

    def test_receive_channel_message_is_not_direct(self):
        adapter, iface = make()
        got: list[IncomingMessage] = []
        adapter.on_message(got.append)
        adapter.connect()
        iface.emit_text("hi all", from_id="!bob", to_id="^all", channel=0)
        self.assertFalse(got[0].is_direct)
        self.assertEqual(got[0].channel, "0")

    def test_send_text_dm_passes_wantack_and_destination(self):
        adapter, iface = make()
        adapter.connect()
        adapter.send_text(Identity("meshtastic", "!bob", "Bob"), "hello")
        self.assertEqual(len(iface.sent), 1)
        self.assertEqual(iface.sent[0]["destinationId"], "!bob")
        self.assertTrue(iface.sent[0]["wantAck"])
        self.assertEqual(iface.sent[0]["text"], "hello")

    def test_send_text_waits_for_ack(self):
        pacer = SpyPacer()
        adapter, _ = make(ack_mode="ack", pacer=pacer)
        adapter.connect()
        adapter.send_text(Identity("meshtastic", "!bob"), "hi")
        self.assertEqual(pacer.waits, [True])  # ack arrived
        self.assertEqual(pacer.fallbacks, 0)

    def test_send_text_returns_on_nak_without_hanging(self):
        pacer = SpyPacer(ack_timeout_s=0.0)
        adapter, _ = make(ack_mode="nak", pacer=pacer)
        adapter.connect()
        adapter.send_text(Identity("meshtastic", "!bob"), "hi")  # must not hang
        self.assertEqual(pacer.waits, [False])  # NAK => event never set => timeout-false

    def test_send_text_returns_on_timeout_without_hanging(self):
        pacer = SpyPacer(ack_timeout_s=0.0)
        adapter, _ = make(ack_mode="withhold", pacer=pacer)
        adapter.connect()
        adapter.send_text(Identity("meshtastic", "!bob"), "hi")  # must not hang
        self.assertEqual(pacer.waits, [False])

    def test_send_text_to_channel_uses_fallback_pacing(self):
        # A reply with no known node id (channel fallback) cannot be ACK-tracked
        # per-node, so the adapter paces with the fixed fallback delay instead.
        pacer = SpyPacer()
        adapter, iface = make(pacer=pacer)
        adapter.connect()
        adapter.send_text(Identity("meshtastic", node_id=None, name="0"), "hi all")
        self.assertEqual(len(iface.sent), 1)
        self.assertEqual(iface.sent[0]["destinationId"], "^all")
        self.assertFalse(iface.sent[0]["wantAck"])  # broadcast: no per-node ack
        self.assertEqual(pacer.fallbacks, 1)

    def test_list_contacts_returns_empty_without_nodedb(self):
        adapter, _ = make()
        adapter.connect()
        self.assertEqual(adapter.list_contacts(), [])


if __name__ == "__main__":
    unittest.main()
