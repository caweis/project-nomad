#!/usr/bin/env python3
"""Path-preserving translating proxy in front of kiwix-serve.

Everything is forwarded byte for byte on the SAME paths Kiwix uses, so /viewer,
/skin/*, /search, /random and /catalog/* are genuinely Kiwix's own shell running
Kiwix's own JavaScript. Only `text/html` under /content/ is rewritten, and only
its text.

Preserving the path is the whole design. viewer.js keeps the content iframe in
sync with location.hash by comparing `contentWindow.location.pathname`, so
pointing the iframe anywhere else starts the ping-pong its own comment warns
about, and we would be patching Kiwix's JavaScript and re-verifying it on every
Kiwix bump. Because the path never moves, no Kiwix JS is modified at all, and
Kiwix's header, search, library and random keep working because they ARE Kiwix.

Language lives in a cookie set by a control injected into the translated page,
so links inside the ZIM need no rewriting either.
"""

import hashlib
import html
import http.cookies
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import blocks
import engine

UPSTREAM = os.environ.get("KIWIX", "http://localhost:8090").rstrip("/")
MODELS = Path(os.environ.get("MODELS", "/models"))
PORT = int(os.environ.get("PORT", "8391"))
# Pages larger than this are forwarded untranslated. A pathological article
# should not be able to tie up every worker or exhaust memory.
MAX_TRANSLATE_BYTES = max(1024, min(16 * 1024 * 1024,
    int(os.environ.get("MAX_TRANSLATE_BYTES", str(4 * 1024 * 1024)))))

COOKIE = "nomadlang"
_translation_slots = threading.BoundedSemaphore(2)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Hand upstream redirects back to the browser instead of following them.

    Kiwix answers a book root such as /content/<book> with a 302 to the ZIM's
    main page. Following it here would serve that page's HTML at the ORIGINAL
    URL, so every relative link and stylesheet in it resolves one directory
    too high: styling is lost and every article link 404s.
    """

    def redirect_request(self, *args, **kwargs):
        return None


# urlopen() follows redirects by default; this opener raises them as HTTPError
# so they are forwarded below like any other non-200 response.
_opener = urllib.request.build_opener(_NoRedirect)

# Display names for the languages our local model packages cover. A language
# only appears in the control if its model is actually on disk.
LANG_NAMES = {
    "af": "Afrikaans", "ar": "Arabic", "bg": "Bulgarian", "bn": "Bengali",
    "bs": "Bosnian", "ca": "Catalan", "cs": "Czech", "da": "Danish",
    "de": "German", "el": "Greek", "es": "Spanish", "et": "Estonian",
    "eu": "Basque", "fa": "Persian", "fi": "Finnish", "fr": "French",
    "gl": "Galician", "gu": "Gujarati", "he": "Hebrew", "hi": "Hindi",
    "hr": "Croatian", "hu": "Hungarian", "id": "Indonesian", "is": "Icelandic",
    "it": "Italian", "ja": "Japanese", "kn": "Kannada", "ko": "Korean",
    "lt": "Lithuanian", "lv": "Latvian", "ml": "Malayalam", "mr": "Marathi",
    "ms": "Malay", "nb": "Norwegian", "nl": "Dutch", "pl": "Polish",
    "pt": "Portuguese", "ro": "Romanian", "ru": "Russian", "sk": "Slovak",
    "sl": "Slovenian", "sr": "Serbian", "sv": "Swedish", "ta": "Tamil",
    "te": "Telugu", "th": "Thai", "tr": "Turkish", "uk": "Ukrainian",
    "ur": "Urdu", "vi": "Vietnamese",
}

# Strip hop-by-hop headers and the duplicate Server/Date fields. Rewritten
# pages also drop the upstream length and encoding below.
HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "server", "date",
}


def available_languages() -> dict[str, str]:
    """Languages with an en->xx model present on disk, in display order."""
    found = {}
    if MODELS.is_dir():
        for entry in sorted(MODELS.iterdir()):
            if not engine.model_ready(entry.name):
                continue
            pair = entry.name
            if len(pair) == 4 and pair.startswith("en"):
                code = pair[2:]
                found[code] = LANG_NAMES.get(code, code.upper())
    return found


LANGS = available_languages()

BAR_CSS = """
#nomad-tr{position:sticky;top:0;z-index:2147483000;display:flex;align-items:center;
 flex-wrap:wrap;gap:9px;padding:7px 14px;background:#36361A;color:#F1E6C8;
 font:13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
#nomad-tr .t{opacity:.75}
#nomad-tr a{font:inherit;font-size:12.5px;color:#F1E6C8;background:transparent;
 border:1px solid #66663F;border-radius:999px;padding:3px 11px;cursor:pointer;
 text-decoration:none}
#nomad-tr a:hover{background:#66663F}
#nomad-tr a.on{background:#F1E6C8;color:#36361A;border-color:#F1E6C8;font-weight:600}
#nomad-tr .g{flex:1}
#nomad-tr .s{opacity:.6;font-size:11.5px;font-variant-numeric:tabular-nums}
"""

def build_bar(lang: str, status: str, target: str) -> str:
    """The in-page language control.

    Labelled "Translate this page" rather than with a globe or a bare language
    name, deliberately: Kiwix's own toolbar already has a globe that switches
    the INTERFACE language, and the two sit close together with no visual
    relationship. Naming ours after what it acts on is the cheapest way to stop
    a user reaching for the wrong one and concluding the feature is broken.
    """
    buttons = []
    for code, name in [("", "Original")] + sorted(LANGS.items(), key=lambda kv: kv[1]):
        classes = "on" if code == lang else ""
        href = "/nomad-lang?" + urllib.parse.urlencode({"set": code, "to": target})
        buttons.append(
            f'<a class="{classes}" href="{html.escape(href, quote=True)}">'
            f'{html.escape(name)}</a>'
        )
    return (
        f'<div id="nomad-tr"><span class="t">Translate this page</span>{"".join(buttons)}'
        f'<span class="g"></span><span class="s">{status}</span></div>'
        f"<style>{BAR_CSS}</style>"
    )


def rewrite(body: str, lang: str, status_override: str | None = None,
            target: str = "/viewer") -> str:
    """Translate block text in place and inject the control."""
    status = status_override or "not translated"

    if lang:
        if not _translation_slots.acquire(timeout=10):
            raise RuntimeError("Translation service is busy")
        started = time.time()
        try:
            jobs, spans = blocks.plan(body)
            if jobs:
                words = sum(len(job.split()) for job in jobs)
                done = engine.translate_blocks("en" + lang, jobs)
                body = blocks.splice(body, spans, done)
                elapsed = round((time.time() - started) * 1000)
                status = f"{words:,} words · {len(jobs)} blocks · {elapsed:,} ms"
            else:
                status = "nothing to translate"
        finally:
            _translation_slots.release()

    bar = build_bar(lang, status, target)
    if re.search(r"(?i)<body[^>]*>", body):
        return re.sub(r"(?i)(<body[^>]*>)", lambda m: m.group(1) + bar, body, count=1)
    return bar + body


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "nomad-translate-proxy"

    def log_message(self, *args):
        # The upstream Kiwix container already logs requests.
        pass

    def _lang(self) -> str:
        raw = self.headers.get("Cookie", "")
        try:
            jar = http.cookies.SimpleCookie(raw)
        except Exception:
            return ""
        value = jar[COOKIE].value if COOKIE in jar else ""
        return value if value in LANGS else ""

    def do_GET(self, body_only: bool = False):
        # Setting the language via a URL makes a given language linkable and
        # bookmarkable rather than only reachable by clicking the control.
        if self.path.startswith("/nomad-lang"):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code = query.get("set", [""])[0]
            code = code if code in LANGS else ""
            target = query.get("to", ["/viewer"])[0]
            # A Location header must be a local path without header controls.
            # Browsers may also read /\host as a network-path redirect.
            if (
                not target.startswith("/")
                or target.startswith("//")
                or "\\" in target
                or any(not 32 <= ord(char) <= 126 for char in target)
            ):
                target = "/viewer"
            self.send_response(302)
            self.send_header("Set-Cookie", f"{COOKIE}={code}; Path=/; Max-Age=31536000; SameSite=Lax")
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if (not self.path.startswith("/") or self.path.startswith("//")
                or "\\" in self.path or any(ord(c) < 32 for c in self.path)):
            self.send_error(400, "Invalid library path")
            return

        request = urllib.request.Request(UPSTREAM + self.path, method="GET")
        forwarded = ["Range", "User-Agent", "Accept"]
        # A Kiwix 304 is for its original bytes, not our language variant.
        if not self.path.startswith("/content/"):
            forwarded.extend(["If-None-Match", "If-Modified-Since"])
        for header in forwarded:
            if self.headers.get(header):
                request.add_header(header, self.headers[header])
        # Accept-Encoding is deliberately not forwarded: we want plain bytes so
        # HTML can be rewritten without decompressing first.

        try:
            response = _opener.open(request, timeout=120)
            status, headers = response.status, response.headers
        except urllib.error.HTTPError as exc:
            # Forwarded as-is, which is how Kiwix's own 404 and 400 pages keep
            # coming back byte for byte.
            response = exc
            status, headers = exc.code, exc.headers
            # An absolute Location would point the browser at the upstream
            # container name, which it cannot reach. Keep it on this origin.
            location = headers.get("Location", "")
            if location.startswith(UPSTREAM):
                del headers["Location"]
                headers["Location"] = location[len(UPSTREAM):] or "/"
        except Exception as exc:
            print(f"nomad-translate upstream: {type(exc).__name__}", file=sys.stderr,
                  flush=True)
            message = b"Translation proxy could not reach the library"
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
            return

        content_type = headers.get("Content-Type", "").lower()
        may_translate = (
            self.path.startswith("/content/")
            and "text/html" in content_type
            and ("charset=" not in content_type or "charset=utf-8" in content_type)
            and headers.get("Content-Encoding", "identity").lower() == "identity"
            and status == 200
        )
        # Read at most one byte past the limit. Other Kiwix responses, including
        # large media files, are streamed and never held in full in proxy RAM.
        data = response.read(MAX_TRANSLATE_BYTES + 1) if may_translate else b""
        translatable = may_translate and len(data) <= MAX_TRANSLATE_BYTES

        lang = self._lang() if translatable else ""
        if translatable:
            try:
                data = rewrite(data.decode("utf-8", "ignore"), lang,
                               target=self.path).encode("utf-8")
            except Exception as exc:
                # Model errors must not expose local paths inside article HTML.
                print(f"nomad-translate: {type(exc).__name__}", file=sys.stderr, flush=True)
                data = rewrite(data.decode("utf-8", "ignore"), "",
                               "translation unavailable", self.path).encode("utf-8")

        self.send_response(status)
        for key, value in headers.items():
            if key.lower() in HOP:
                continue
            if translatable and key.lower() in {"content-length", "content-encoding"}:
                continue
            if translatable and key.lower() == "etag":
                continue
            # The page also carries the language bar, which changes whenever a
            # language is added. Kiwix's max-age=3600 kept the old bar on screen
            # for up to an hour, and a normal refresh does not reach the
            # article frame. Revalidating every time is cheap on a local box.
            if translatable and key.lower() == "cache-control":
                continue
            self.send_header(key, value)
        if translatable:
            self.send_header("Vary", "Cookie")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("ETag", '"' + hashlib.sha256(data).hexdigest() + '"')
            self.send_header("Content-Length", str(len(data)))
        else:
            # urllib strips chunk framing. Closing defines the end of a
            # streamed response when Kiwix did not send Content-Length.
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if not body_only:
            try:
                if data:
                    self.wfile.write(data)
                if not translatable:
                    for chunk in iter(lambda: response.read(64 * 1024), b""):
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
        response.close()

    def do_HEAD(self):
        self.do_GET(body_only=True)


if __name__ == "__main__":
    if LANGS:
        print(
            f"nomad-translate: {len(LANGS)} languages available "
            f"({', '.join(sorted(LANGS))})",
            flush=True,
        )
    else:
        print(
            "nomad-translate: no models found, forwarding the library untranslated",
            file=sys.stderr,
            flush=True,
        )

    print(f"nomad-translate: listening on 0.0.0.0:{PORT} -> {UPSTREAM}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
