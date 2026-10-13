"""Checks translation batching and whitespace without loading a model."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import engine


class Tokenizer:
    def encode(self, text, out_type):
        assert out_type is str
        return text.split()

    def decode_pieces(self, pieces):
        return " ".join(pieces)


class Translator:
    def translate_batch(self, batches, **_):
        return [SimpleNamespace(hypotheses=[["translated"]]) for _ in batches]


class EngineTests(unittest.TestCase):
    def test_preserves_outer_whitespace_and_batch_count(self):
        with patch("engine._load", return_value=(Tokenizer(), Translator())):
            result = engine.translate_blocks("enfr", ["  Hello world.\n", "Cold water"])
        self.assertEqual(result, ["  translated\n", "translated"])

    def test_no_jobs_does_not_load_a_model(self):
        with patch("engine._load") as load:
            self.assertEqual(engine.translate_blocks("enfr", []), [])
            load.assert_not_called()


if __name__ == "__main__":
    unittest.main()
