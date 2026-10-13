"""Regression checks for HTML text extraction and safe replacement."""

import unittest

import blocks


class BlocksTest(unittest.TestCase):
    def test_preserves_links_and_attributes(self):
        source = '<p>Cold <a href="/content/book/Water" title="Water">water</a> today.</p>'
        jobs, spans = blocks.plan(source)
        self.assertEqual(jobs, ["Cold ", "water", " today."])
        result = blocks.splice(source, spans, ["Froid ", "eau", " aujourd'hui."])
        self.assertEqual(
            result,
            '<p>Froid <a href="/content/book/Water" title="Water">eau</a> aujourd\'hui.</p>',
        )

    def test_entities_are_decoded_once_and_output_is_escaped(self):
        source = '<p>Water &amp; air</p>'
        jobs, spans = blocks.plan(source)
        self.assertEqual(jobs, ["Water & air"])
        self.assertEqual(blocks.splice(source, spans, ['<script>alert(1)</script>']),
                         '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')

    def test_entity_without_semicolon_does_not_overlap_next_text(self):
        source = "<p>Rock &copy today and blue sky.</p>"
        jobs, spans = blocks.plan(source)
        self.assertEqual(jobs, ["Rock © today and blue sky."])
        self.assertEqual(len(spans), 1)
        self.assertEqual(blocks.splice(source, spans, ["Translated words"]),
                         "<p>Translated words</p>")

    def test_opaque_content_is_untouched(self):
        source = '<p>Hello <code>delete files</code> friend</p><script>evil words</script>'
        jobs, _ = blocks.plan(source)
        self.assertEqual(jobs, ["Hello ", " friend"])

    def test_mismatch_fails_loudly(self):
        with self.assertRaises(ValueError):
            blocks.splice("<p>Hi</p>", [(3, 5)], [])


if __name__ == "__main__":
    unittest.main()
