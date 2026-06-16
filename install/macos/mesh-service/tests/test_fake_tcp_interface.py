"""Tests for FakeTCPInterface — the stub the adapter integration tests run on.

The stub's whole value is fidelity to the REAL meshtastic 2.7.9 surface (verified
against the installed source): the TCPInterface constructor signature, the
`meshtastic.receive.text` topic published via the real `pubsub` broker with
`packet=`/`interface=` kwargs, the packet dict shape (from/to/fromId/toId/decoded
with portnum + text), and the ROUTING_APP ack delivered to sendText's onResponse
callback. These tests pin that contract.
"""

import unittest

from pubsub import pub

from tests.stubs.fake_tcp_interface import FakeTCPInterface


class TestFakeTCPInterface(unittest.TestCase):
    def tearDown(self):
        # Kill global-broker bleed between tests (the real pub broker is process-global).
        pub.unsubAll()

    def test_constructor_records_host_port_and_opens_no_socket(self):
        iface = FakeTCPInterface("radio.local", portNumber=4403)
        self.assertEqual(iface.hostname, "radio.local")
        self.assertEqual(iface.portNumber, 4403)
        self.assertIsNone(iface.socket)  # never opened a real connection

    def test_get_my_node_info_returns_stable_hexid(self):
        iface = FakeTCPInterface("radio.local")
        info = iface.getMyNodeInfo()
        node_id = info["user"]["id"]
        self.assertTrue(node_id.startswith("!"))
        # Stable across calls — the adapter learns this once at connect().
        self.assertEqual(iface.getMyNodeInfo()["user"]["id"], node_id)

    def test_send_text_records_sent_with_real_kwargs(self):
        iface = FakeTCPInterface("radio.local")
        iface.sendText("hello", destinationId="!bob", wantAck=True, channelIndex=2)
        self.assertEqual(len(iface.sent), 1)
        rec = iface.sent[0]
        self.assertEqual(rec["text"], "hello")
        self.assertEqual(rec["destinationId"], "!bob")
        self.assertTrue(rec["wantAck"])
        self.assertEqual(rec["channelIndex"], 2)

    def test_send_text_with_ack_calls_onresponse_with_routing_ack(self):
        iface = FakeTCPInterface("radio.local", ack_mode="ack")
        acks: list[dict] = []
        iface.sendText("hi", destinationId="!bob", wantAck=True, onResponse=acks.append)
        self.assertEqual(len(acks), 1)
        routing = acks[0]["decoded"]["routing"]
        self.assertEqual(routing["errorReason"], "NONE")  # NONE == delivered/ack
        self.assertEqual(acks[0]["decoded"]["portnum"], "ROUTING_APP")

    def test_send_text_nak_mode_calls_onresponse_with_error(self):
        iface = FakeTCPInterface("radio.local", ack_mode="nak")
        acks: list[dict] = []
        iface.sendText("hi", destinationId="!bob", wantAck=True, onResponse=acks.append)
        self.assertEqual(len(acks), 1)
        self.assertNotEqual(acks[0]["decoded"]["routing"]["errorReason"], "NONE")

    def test_send_text_withhold_mode_never_calls_onresponse(self):
        iface = FakeTCPInterface("radio.local", ack_mode="withhold")
        acks: list[dict] = []
        iface.sendText("hi", destinationId="!bob", wantAck=True, onResponse=acks.append)
        self.assertEqual(acks, [])  # models a timeout — ack never arrives

    def test_send_text_without_wantack_never_acks(self):
        iface = FakeTCPInterface("radio.local", ack_mode="ack")
        acks: list[dict] = []
        iface.sendText("hi", destinationId="!bob", wantAck=False, onResponse=acks.append)
        self.assertEqual(acks, [])

    def test_emit_text_publishes_on_real_receive_topic(self):
        iface = FakeTCPInterface("radio.local")
        received: list[tuple] = []

        def on_receive(packet, interface):  # real meshtastic subscriber shape
            received.append((packet, interface))

        pub.subscribe(on_receive, "meshtastic.receive.text")
        iface.emit_text("how do I purify water", from_id="!bob", to_id=iface.our_node_id)

        self.assertEqual(len(received), 1)
        packet, interface = received[0]
        self.assertIs(interface, iface)
        self.assertEqual(packet["decoded"]["text"], "how do I purify water")
        self.assertEqual(packet["decoded"]["portnum"], "TEXT_MESSAGE_APP")
        self.assertEqual(packet["fromId"], "!bob")
        self.assertEqual(packet["toId"], iface.our_node_id)

    def test_emit_text_channel_message_carries_channel_and_broadcast_to(self):
        iface = FakeTCPInterface("radio.local")
        received: list[dict] = []

        # A named local (not a bare lambda): PyPubSub keeps only a weak reference to
        # its listeners, so a lambda is GC'd before sendMessage fires — the real
        # library always subscribes a named function for the same reason.
        def on_receive(packet, interface):
            received.append(packet)

        pub.subscribe(on_receive, "meshtastic.receive.text")
        iface.emit_text("hi all", from_id="!bob", to_id="^all", channel=0)
        self.assertEqual(received[0]["toId"], "^all")
        self.assertEqual(received[0]["channel"], 0)


if __name__ == "__main__":
    unittest.main()
