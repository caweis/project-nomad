"""Tests for the safety router + output sanitizer."""

import unittest

from mesh_service.safety import (
    CANNED_RESPONSES,
    PREFIX_LIFE_THREAT,
    classify_emergency,
    route_query,
    sanitize_model_output,
)


class TestEmergencyRouting(unittest.TestCase):
    def test_life_threats_route_to_canned_messages(self):
        cases = {
            "my friend is not breathing what do I do": "not_breathing",
            "he has severe bleeding from his leg": "severe_bleeding",
            "she has chest pain and left arm hurts": "chest_pain",
            "anaphylaxis where do I use the epipen": "anaphylaxis",
            "found him unconscious and unresponsive": "unresponsive",
            "kid is choking on food and cant breathe": "choking",
            "her face is drooping possible stroke": "stroke",
        }
        for text, expected_key in cases.items():
            self.assertEqual(classify_emergency(text), expected_key, text)
            canned = route_query(text)
            self.assertIsNotNone(canned, f"{text!r} should be hard-routed")
            self.assertEqual(canned, CANNED_RESPONSES[expected_key])

    def test_canned_messages_lead_with_severity_marker_and_seek_help(self):
        for key, msg in CANNED_RESPONSES.items():
            self.assertTrue(msg.startswith(PREFIX_LIFE_THREAT), f"{key} missing '!' prefix")
            low = msg.lower()
            self.assertTrue(
                any(w in low for w in ("ems", "help", "human", "medic")),
                f"{key} must direct to professional help",
            )

    def test_canned_messages_fit_one_radio_packet(self):
        for key, msg in CANNED_RESPONSES.items():
            self.assertLessEqual(len(msg.encode("utf-8")), 200, f"{key} exceeds 200 bytes")

    def test_normal_queries_are_not_routed(self):
        for text in (
            "how do I purify water from a stream",
            "what berries are safe to eat here",
            "how long does canned food last",
        ):
            self.assertIsNone(classify_emergency(text))
            self.assertIsNone(route_query(text))


class TestSanitizer(unittest.TestCase):
    def test_strips_reasoning_markdown_and_emoji(self):
        raw = "I will **help** you ☕ <think>let me reason</think> see [the docs](http://x) now 🔥"
        out = sanitize_model_output(raw)
        self.assertNotIn("think", out.lower())
        self.assertNotIn("*", out)
        self.assertNotIn("☕", out)
        self.assertNotIn("🔥", out)
        self.assertNotIn("http", out)
        self.assertIn("help", out)
        self.assertIn("the docs", out)  # link label is kept

    def test_keeps_latin_accents(self):
        self.assertEqual(sanitize_model_output("café résumé naïve"), "café résumé naïve")

    def test_collapses_whitespace(self):
        self.assertEqual(sanitize_model_output("a\n\n  b\t c"), "a b c")


if __name__ == "__main__":
    unittest.main()
