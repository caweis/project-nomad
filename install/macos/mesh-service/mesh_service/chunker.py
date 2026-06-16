"""LoRa-aware message chunking.

Radio payloads are tiny (Meshtastic ~200 usable bytes, MeshCore ~133 chars), so a
reply longer than one packet is split into a few numbered parts. Splitting is by
UTF-8 BYTE length (not character count), prefers word boundaries, never splits a
multi-byte character, reserves room for the " [i/N]" suffix so every emitted part
stays within the radio's limit, and caps the number of parts so one chatty answer
cannot flood shared airtime (the research's MAX_CHUNKS).
"""

from __future__ import annotations

DEFAULT_MAX_BYTES = 200
DEFAULT_MAX_CHUNKS = 5
_ELLIPSIS = "…"  # …


def byte_len(s: str) -> int:
    """UTF-8 byte length — the unit a LoRa payload is actually measured in."""
    return len(s.encode("utf-8"))


def _take_within_bytes(s: str, max_bytes: int) -> str:
    """Longest prefix of `s` that fits in `max_bytes` UTF-8 bytes, on a char boundary."""
    enc = s.encode("utf-8")
    if len(enc) <= max_bytes:
        return s
    # Drop any partial trailing multi-byte character.
    return enc[:max_bytes].decode("utf-8", errors="ignore")


def chunk_message(
    text: str,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_chunks: int = DEFAULT_MAX_CHUNKS,
) -> list[str]:
    """Split `text` into at most `max_chunks` radio-sized parts.

    A message that fits whole gets no suffix. Anything longer is split into
    `[i/N]`-suffixed parts, each within `max_bytes`. If the text needs more than
    `max_chunks` parts, the tail is truncated with an ellipsis.
    """
    text = " ".join(text.split())  # normalize all whitespace to single spaces
    if not text:
        return []
    if byte_len(text) <= max_bytes:
        return [text]

    # Reserve the worst-case suffix (" [N/N]") up front so every emitted part —
    # content plus suffix — stays within max_bytes regardless of the final count.
    suffix_reserve = byte_len(f" [{max_chunks}/{max_chunks}]")
    budget = max_bytes - suffix_reserve
    if budget < 1:
        raise ValueError("max_bytes is too small to carry a chunk suffix")

    parts: list[str] = []
    remaining = text
    while remaining and len(parts) < max_chunks:
        if byte_len(remaining) <= budget:
            parts.append(remaining)
            remaining = ""
            break
        head = _take_within_bytes(remaining, budget)
        space = head.rfind(" ")
        # Break on the word boundary unless it lands in the first ~40% of the
        # budget (a very early boundary means a long unbroken token — hard-cut
        # so we do not waste most of a packet).
        if space > 0 and byte_len(head[:space]) >= budget * 0.4:
            cut, drop = space, 1  # consume the boundary space
        else:
            cut, drop = len(head), 0
        parts.append(head[:cut].strip())
        remaining = remaining[cut + drop:].strip()

    if remaining:
        # More content than max_chunks can carry — truncate the tail. Caps shared
        # airtime; a relayed partial answer is better than flooding the channel.
        tail = _take_within_bytes(parts[-1], budget - byte_len(_ELLIPSIS)).rstrip()
        parts[-1] = tail + _ELLIPSIS

    total = len(parts)
    return [f"{p} [{i}/{total}]" for i, p in enumerate(parts, 1)]
