"""End-to-end: REAL MeshtasticAdapter over FakeTCPInterface, wired to the REAL
Responder + a MockAI + a spy AirtimePacer, through the SAME queue+single-worker
topology app.py uses.

This is the P1 payoff — the whole receive -> enqueue -> worker -> gate -> safety ->
AI -> chunk -> paced send path runs with no radio and no model. The receive path
only enqueues; the single worker is the only caller of responder.handle_message,
preserving the receive-path-cheap invariant.
"""

import queue
import threading
import unittest

from pubsub import pub

from mesh_service.adapter import Identity
from mesh_service.meshtastic_adapter import MeshtasticAdapter
from mesh_service.pacing import AirtimePacer
from mesh_service.rate_limit import RateLimiter
from mesh_service.responder import Responder
from mesh_service.safety import CANNED_RESPONSES, FIRST_CONTACT_DISCLAIMER
from tests.stubs.fake_tcp_interface import FakeTCPInterface

OUR = "!aabbccdd"


class MockAI:
    def __init__(self, answer="Boil it one minute, or filter then treat."):
        self.answer = answer
        self.calls: list[str] = []

    def ask(self, query):
        self.calls.append(query)
        return self.answer


class SpyPacer(AirtimePacer):
    """Records ACK waits and fallback paces; injects a no-op sleep (no real airtime)."""

    def __init__(self, **kw):
        super().__init__(ack_timeout_s=0.0, sleep=lambda _dt: None, **kw)
        self.waits = 0
        self.fallbacks = 0

    def wait_for_ack_or_timeout(self, ack_event):
        self.waits += 1
        return super().wait_for_ack_or_timeout(ack_event)

    def pace_fallback(self):
        self.fallbacks += 1


class Harness:
    """Replicates app.py's topology: receive enqueues; one worker drains + responds."""

    def __init__(self, ai=None, rate=None, pacer=None):
        self.iface = FakeTCPInterface("radio.local", our_node_id=OUR, ack_mode="ack")
        self.pacer = pacer or SpyPacer()
        self.adapter = MeshtasticAdapter(
            "radio.local", pacer=self.pacer, interface_factory=lambda **kw: self.iface
        )
        self.ai = ai or MockAI()
        self.responder = Responder(self.adapter, self.ai, rate, our_node_id=OUR)
        self._inbox: "queue.Queue" = queue.Queue()

        # Receive path: enqueue ONLY — never call the AI here (the hard invariant).
        self.adapter.on_message(self._inbox.put)
        self.adapter.connect()

        self._worker = threading.Thread(target=self._drain, daemon=True)
        self._worker.start()

    def _drain(self):
        while True:
            message = self._inbox.get()
            try:
                if message is None:
                    return
                self.responder.handle_message(message)
            finally:
                self._inbox.task_done()

    def deliver(self, text, from_id="!bob", to_id=OUR, channel=0):
        self.iface.emit_text(text, from_id=from_id, to_id=to_id, channel=channel)
        self._inbox.join()  # deterministic: wait until the worker has processed it

    def stop(self):
        self._inbox.put(None)
        self._worker.join(timeout=2)

    @property
    def sent_text(self):
        return [s["text"] for s in self.iface.sent]


class TestMeshtasticIntegration(unittest.TestCase):
    def tearDown(self):
        pub.unsubAll()

    def test_dm_question_gets_disclaimer_then_paced_answer(self):
        h = Harness(ai=MockAI("Boil it one minute, or filter then treat."))
        self.addCleanup(h.stop)
        h.deliver("@ai how do I purify water")

        self.assertEqual(h.sent_text[0], FIRST_CONTACT_DISCLAIMER)
        self.assertIn("Boil it one minute", h.sent_text[-1])
        self.assertEqual(h.ai.calls, ["how do I purify water"])
        # Every DM part was sent reliably (wantAck) and the pacer waited per part.
        self.assertTrue(all(s["wantAck"] for s in h.iface.sent))
        self.assertEqual(h.pacer.waits, len(h.iface.sent))

    def test_life_threat_uses_canned_message_and_never_calls_ai(self):
        h = Harness(ai=MockAI("AI MUST NOT ANSWER"))
        self.addCleanup(h.stop)
        h.deliver("@ai my friend is not breathing")
        self.assertIn(CANNED_RESPONSES["not_breathing"], h.sent_text)
        self.assertEqual(h.ai.calls, [])  # routed away from the model

    def test_long_answer_is_chunked_into_paced_parts_each_within_200_bytes(self):
        h = Harness(ai=MockAI("word " * 200))  # well over one packet
        self.addCleanup(h.stop)
        h.deliver("@ai tell me everything")
        parts = [t for t in h.sent_text if t != FIRST_CONTACT_DISCLAIMER]
        self.assertGreater(len(parts), 1)
        for part in parts:
            self.assertLessEqual(len(part.encode("utf-8")), 200)
        # Each emitted part was ACK-paced.
        self.assertEqual(h.pacer.waits, len(h.iface.sent))

    def test_channel_message_without_trigger_sends_nothing(self):
        h = Harness()
        self.addCleanup(h.stop)
        h.deliver("just chatting", to_id="^all", channel=0)
        self.assertEqual(h.iface.sent, [])
        self.assertEqual(h.ai.calls, [])

    def test_message_from_our_own_node_is_ignored(self):
        h = Harness()
        self.addCleanup(h.stop)
        h.deliver("@ai loop", from_id=OUR, to_id=OUR)
        self.assertEqual(h.iface.sent, [])

    def test_rate_limit_blocks_a_chatty_node(self):
        rate = RateLimiter(per_node_per_min=1, global_per_min=99)
        h = Harness(rate=rate)
        self.addCleanup(h.stop)
        h.deliver("@ai one")
        before = len(h.iface.sent)
        h.deliver("@ai two")  # over the per-node cap
        self.assertEqual(len(h.iface.sent), before)


if __name__ == "__main__":
    unittest.main()
