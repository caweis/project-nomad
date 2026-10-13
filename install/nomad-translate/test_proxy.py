#!/usr/bin/env python3
"""Exercise the local language redirect without Kiwix or a model download."""

import io
import sys
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import proxy  # noqa: E402


def language_redirect(target: str) -> bytes:
    handler = proxy.Handler.__new__(proxy.Handler)
    handler.path = f"/nomad-lang?to={target}"
    handler.headers = {}
    handler.request_version = "HTTP/1.1"
    handler.requestline = f"GET {handler.path} HTTP/1.1"
    handler.wfile = io.BytesIO()
    handler.do_GET()
    return handler.wfile.getvalue()


class LanguageRedirectTests(unittest.TestCase):
    def test_valid_local_path_is_preserved(self):
        response = language_redirect("%2Fcontent%2Fbook%3Fq%3Dtest")
        self.assertIn(b"Location: /content/book?q=test\r\n", response)

    def test_network_path_is_rejected(self):
        response = language_redirect("%2F%2Fevil.example")
        self.assertIn(b"Location: /viewer\r\n", response)

    def test_control_characters_cannot_create_response_headers(self):
        response = language_redirect("%2Fviewer%0D%0AX-Probe%3A%20yes")
        self.assertIn(b"Location: /viewer\r\n", response)
        self.assertNotIn(b"X-Probe: yes\r\n", response)

    def test_backslash_network_path_is_rejected(self):
        response = language_redirect("%2F%5Cevil.example")
        self.assertIn(b"Location: /viewer\r\n", response)

    def test_non_ascii_location_is_rejected_without_crashing(self):
        response = language_redirect("%2F%F0%9F%92%A9")
        self.assertIn(b"Location: /viewer\r\n", response)

    def test_translation_keeps_link_targets_and_escapes_model_text(self):
        source = '<body><p>Cold <a href="/content/book/Water">water</a> today.</p></body>'
        with patch.dict(proxy.LANGS, {"fr": "French"}, clear=True):
            with patch("proxy.engine.translate_blocks", return_value=[
                "Froid ", "<script>alert(1)</script>", " aujourd'hui.",
            ]):
                result = proxy.rewrite(source, "fr")
        self.assertIn('href="/content/book/Water"', result)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', result)
        self.assertNotIn('<script>alert(1)</script>', result)

    def test_language_control_uses_links_without_inline_javascript(self):
        with patch.dict(proxy.LANGS, {"fr": "French"}, clear=True):
            bar = proxy.build_bar("fr", "translated", "/content/book/page?q=water")
        self.assertIn('href="/nomad-lang?set=fr&amp;to=%2Fcontent%2Fbook%2Fpage%3Fq%3Dwater"', bar)
        self.assertNotIn("onclick", bar)
        self.assertNotIn("<script", bar)

    def test_large_article_is_streamed_without_an_unbounded_read(self):
        payload = b"<html>" + b"a" * 100 + b"</html>"

        class Upstream:
            status = 200
            def __init__(self):
                self.offset = 0
                self.headers = Message()
                self.headers["Content-Type"] = "text/html"
                self.headers["Content-Length"] = str(len(payload))
                self.read_sizes = []
            def read(self, count):
                self.read_sizes.append(count)
                chunk = payload[self.offset:self.offset + count]
                self.offset += len(chunk)
                return chunk
            def close(self): pass

        upstream = Upstream()
        handler = proxy.Handler.__new__(proxy.Handler)
        handler.path = "/content/book/large.html"
        handler.headers = {}
        handler.request_version = "HTTP/1.1"
        handler.requestline = "GET /content/book/large.html HTTP/1.1"
        handler.wfile = io.BytesIO()
        with patch.object(proxy, "MAX_TRANSLATE_BYTES", 16):
            with patch.object(proxy._opener, "open", return_value=upstream):
                handler.do_GET()
        headers, body = handler.wfile.getvalue().split(b"\r\n\r\n", 1)
        self.assertEqual(body, payload)
        self.assertIn(b"Content-Length: 113", headers)
        self.assertIn(b"Connection: close", headers)
        self.assertEqual(upstream.read_sizes[0], 17)
        self.assertTrue(all(size <= 64 * 1024 for size in upstream.read_sizes))


if __name__ == "__main__":
    unittest.main()
