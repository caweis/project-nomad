"""Find article text without changing its HTML tags or attributes."""

import html
import re
from html.parser import HTMLParser

OPAQUE = {"script", "style", "code", "pre", "math", "svg", "textarea"}
HAS_TEXT = re.compile(r"[A-Za-z]{2}")


class TextFinder(HTMLParser):
    """Collect source offsets of text nodes, including adjacent HTML entities."""

    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0]
        for line in source.splitlines(keepends=True):
            self.lines.append(self.lines[-1] + len(line))
        self.spans: list[tuple[int, int]] = []
        self.opaque: list[str] = []

    def _offset(self) -> int:
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def _append(self, length: int) -> None:
        if self.opaque or length == 0:
            return
        start = self._offset()
        end = start + length
        if self.spans and start < self.spans[-1][1]:
            raise ValueError("HTML text spans overlap")
        if self.spans and self.spans[-1][1] == start:
            self.spans[-1] = (self.spans[-1][0], end)
        else:
            self.spans.append((start, end))

    def handle_starttag(self, tag, attrs):
        if tag in OPAQUE:
            self.opaque.append(tag)

    def handle_endtag(self, tag):
        if self.opaque and tag == self.opaque[-1]:
            self.opaque.pop()

    def handle_data(self, data):
        self._append(len(data))

    def handle_entityref(self, name):
        self._append(self._entity_length("&" + name))

    def handle_charref(self, name):
        self._append(self._entity_length("&#" + name))

    def _entity_length(self, value: str) -> int:
        return len(value) + int(self.source.startswith(value + ";", self._offset()))


def plan(body: str) -> tuple[list[str], list[tuple[int, int]]]:
    """Return decoded text jobs and their exact source spans."""
    finder = TextFinder(body)
    finder.feed(body)
    jobs = []
    spans = []
    for start, end in finder.spans:
        value = html.unescape(body[start:end])
        if HAS_TEXT.search(value):
            jobs.append(value)
            spans.append((start, end))
    return jobs, spans


def splice(body: str, spans: list[tuple[int, int]], replacements: list[str]) -> str:
    """Replace only text nodes, from the end so offsets stay stable."""
    if len(spans) != len(replacements):
        raise ValueError("A translation is required for every text span")
    for (start, end), value in sorted(zip(spans, replacements), reverse=True):
        body = body[:start] + html.escape(value, quote=False) + body[end:]
    return body
