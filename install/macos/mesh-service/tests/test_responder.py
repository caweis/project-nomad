"""End-to-end responder loop tests against the mock adapter + a mock AI.

This is the P0 payoff: the whole receive -> gate -> safety -> AI -> chunk -> send
path runs with no radio and no model.
"""

import logging
import unittest

# The AI-failure test deliberately raises inside the responder, which logs the
# exception. Silence it so passing-test output stays clean.
logging.disable(logging.CRITICAL)

from mesh_service.adapter import Identity, IncomingMessage
from mesh_service.mock_adapter import MockAdapter
from mesh_service.rate_limit import RateLimiter
from mesh_service.responder import Responder
from mesh_service.safety import CANNED_RESPONSES, FIRST_CONTACT_DISCLAIMER

OUR = "!self"


class MockAI:
    def __init__(self, answer="Boil it one minute, or filter then treat."):
        self.answer = answer
        self.calls = []

    def ask(self, query):
        self.calls.append(query)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def dm(text, node="!bob"):
    return IncomingMessage(text=text, sender=Identity("meshtastic", node, "Bob"), is_direct=True)


def chan(text, node="!bob", channel="LongFast"):
    return IncomingMessage(
        text=text, sender=Identity("meshtastic", node, "Bob"), is_direct=False, channel=channel
    )


def build(ai=None, rate=None):
    adapter = MockAdapter()
    responder = Responder(adapter, ai or MockAI(), rate, our_node_id=OUR)
    responder.start()
    return adapter, responder


class TestResponder(unittest.TestCase):
    def test_dm_gets_disclaimer_then_answer(self):
        ai = MockAI("Boil it one minute.")
        adapter, _ = build(ai)
        adapter.inject(dm("@ai how do I purify water"))
        self.assertEqual(adapter.sent_bodies[0], FIRST_CONTACT_DISCLAIMER)
        self.assertIn("Boil it one minute.", adapter.sent_bodies[-1])
        self.assertEqual(ai.calls, ["how do I purify water"])

    def test_disclaimer_only_on_first_contact(self):
        adapter, _ = build()
        adapter.inject(dm("@ai first"))
        adapter.inject(dm("@ai second"))
        self.assertEqual(adapter.sent_bodies.count(FIRST_CONTACT_DISCLAIMER), 1)

    def test_life_threat_uses_canned_message_not_the_ai(self):
        ai = MockAI("AI SHOULD NOT ANSWER THIS")
        adapter, _ = build(ai)
        adapter.inject(dm("@ai my friend is not breathing"))
        self.assertIn(CANNED_RESPONSES["not_breathing"], adapter.sent_bodies)
        self.assertEqual(ai.calls, [])  # the AI was never consulted

    def test_channel_without_mention_is_ignored(self):
        adapter, _ = build()
        adapter.inject(chan("just chatting on the channel"))
        self.assertEqual(adapter.sent, [])

    def test_own_node_is_ignored(self):
        adapter, _ = build()
        adapter.inject(IncomingMessage("@ai loop", Identity("meshtastic", OUR, "me"), is_direct=True))
        self.assertEqual(adapter.sent, [])

    def test_long_answer_is_chunked(self):
        ai = MockAI("word " * 120)  # well over 200 bytes
        adapter, _ = build(ai)
        adapter.inject(dm("@ai tell me a lot"))
        parts = [b for b in adapter.sent_bodies if b != FIRST_CONTACT_DISCLAIMER]
        self.assertGreater(len(parts), 1)
        for p in parts:
            self.assertLessEqual(len(p.encode("utf-8")), 200)

    def test_ai_failure_falls_back_gracefully(self):
        ai = MockAI(RuntimeError("model down"))
        adapter, _ = build(ai)
        adapter.inject(dm("@ai anything"))
        self.assertTrue(any("unavailable" in b.lower() for b in adapter.sent_bodies))

    def test_rate_limited_after_cap(self):
        rate = RateLimiter(per_node_per_min=1, global_per_min=99)
        adapter, _ = build(rate=rate)
        first = adapter.inject(dm("@ai one")) or adapter.sent_bodies[:]
        before = len(adapter.sent)
        adapter.inject(dm("@ai two"))  # second from same node, over the per-node cap
        self.assertEqual(len(adapter.sent), before)  # nothing new sent


if __name__ == "__main__":
    unittest.main()
