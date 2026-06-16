"""Tests for the trigger gate + bot-loop guard."""

import unittest

from mesh_service.adapter import Identity, IncomingMessage
from mesh_service.trigger import should_respond

OUR = "!self"


def msg(text, *, node="!bob", direct, channel=None):
    return IncomingMessage(
        text=text,
        sender=Identity("meshtastic", node, "Bob"),
        is_direct=direct,
        channel=channel,
    )


class TestTrigger(unittest.TestCase):
    def test_dm_responds_without_a_mention(self):
        ok, q = should_respond(msg("how do I purify water", direct=True), our_node_id=OUR)
        self.assertTrue(ok)
        self.assertEqual(q, "how do I purify water")

    def test_dm_strips_the_trigger(self):
        ok, q = should_respond(msg("@ai purify water how", direct=True), our_node_id=OUR)
        self.assertTrue(ok)
        self.assertEqual(q, "purify water how")

    def test_channel_requires_the_mention(self):
        ok, _ = should_respond(msg("hello everyone", direct=False, channel="LongFast"), our_node_id=OUR)
        self.assertFalse(ok)

    def test_channel_with_mention_responds_and_strips(self):
        ok, q = should_respond(msg("hey @ai what is the time", direct=False, channel="X"), our_node_id=OUR)
        self.assertTrue(ok)
        self.assertEqual(q, "hey what is the time")

    def test_ignores_our_own_node(self):
        ok, _ = should_respond(msg("@ai loop?", node=OUR, direct=True), our_node_id=OUR)
        self.assertFalse(ok)

    def test_empty_after_strip_does_not_respond(self):
        ok, _ = should_respond(msg("@ai", direct=True), our_node_id=OUR)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
