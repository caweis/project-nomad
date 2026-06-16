"""Tests for the LoRa chunker. Run: python3 -m unittest (or pytest)."""

import re
import unittest

from mesh_service.chunker import byte_len, chunk_message

SUFFIX_RE = re.compile(r" \[(\d+)/(\d+)\]$")


class TestChunker(unittest.TestCase):
    def test_short_message_is_single_part_with_no_suffix(self):
        self.assertEqual(chunk_message("ok", max_bytes=200), ["ok"])
        # Exactly at the limit still fits as one part.
        msg = "x" * 200
        self.assertEqual(chunk_message(msg, max_bytes=200), [msg])

    def test_empty_or_whitespace_yields_no_parts(self):
        self.assertEqual(chunk_message(""), [])
        self.assertEqual(chunk_message("   \n\t "), [])

    def test_long_message_splits_into_suffixed_parts(self):
        text = "the quick brown fox jumps over the lazy dog and keeps on running"
        parts = chunk_message(text, max_bytes=30, max_chunks=5)
        self.assertGreater(len(parts), 1)
        for i, p in enumerate(parts, 1):
            m = SUFFIX_RE.search(p)
            self.assertIsNotNone(m, f"part {p!r} missing [i/N] suffix")
            self.assertEqual(int(m.group(1)), i)
            self.assertEqual(int(m.group(2)), len(parts))

    def test_every_part_within_max_bytes(self):
        text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo"
        for max_bytes in (20, 30, 50):
            parts = chunk_message(text, max_bytes=max_bytes, max_chunks=5)
            for p in parts:
                self.assertLessEqual(byte_len(p), max_bytes, f"{p!r} exceeds {max_bytes}")

    def test_prefers_word_boundaries(self):
        text = "alpha bravo charlie delta echo foxtrot golf"
        parts = chunk_message(text, max_bytes=24, max_chunks=8)
        # Strip suffixes; rejoin content; it should be the original words in order
        # with no word cut in half (every content token is a real word).
        words = set(text.split())
        for p in parts:
            content = SUFFIX_RE.sub("", p)
            for token in content.split():
                self.assertIn(token, words, f"{token!r} is a split word fragment")

    def test_multibyte_characters_are_never_split(self):
        # Accented + emoji content; each part must decode cleanly (no U+FFFD) and
        # respect the byte budget.
        text = "café " * 12 + "déjà vu naïve façade ☕☕☕ résumé"
        parts = chunk_message(text, max_bytes=25, max_chunks=10)
        for p in parts:
            self.assertNotIn("�", p)  # no replacement char => no broken char
            self.assertLessEqual(byte_len(p), 25)

    def test_caps_at_max_chunks_and_marks_truncation(self):
        text = " ".join(f"word{i}" for i in range(200))
        parts = chunk_message(text, max_bytes=30, max_chunks=3)
        self.assertEqual(len(parts), 3)
        # The final part is truncated with an ellipsis (before its suffix).
        last_content = SUFFIX_RE.sub("", parts[-1])
        self.assertTrue(last_content.endswith("…"), f"{parts[-1]!r} not marked truncated")
        for p in parts:
            self.assertLessEqual(byte_len(p), 30)


if __name__ == "__main__":
    unittest.main()
