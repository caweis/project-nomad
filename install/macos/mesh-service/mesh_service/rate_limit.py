"""Per-node and global rate limiting to bound shared LoRa airtime.

A sliding-window counter with an injectable clock, so tests advance time without
sleeping. The per-node cap throttles one chatty node; the global cap protects the
whole channel from the bridge.
"""

from __future__ import annotations

import time
from collections.abc import Callable


class RateLimiter:
    def __init__(
        self,
        per_node_per_min: int = 3,
        global_per_min: int = 20,
        window_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.per_node = per_node_per_min
        self.global_limit = global_per_min
        self.window = window_s
        self._clock = clock
        self._node_hits: dict[str, list[float]] = {}
        self._global_hits: list[float] = []

    def allow(self, node_id: str) -> bool:
        """Record + allow a send for `node_id`, or refuse if a window is full."""
        now = self._clock()
        self._prune(now)
        if len(self._global_hits) >= self.global_limit:
            return False
        hits = self._node_hits.setdefault(node_id, [])
        if len(hits) >= self.per_node:
            return False
        hits.append(now)
        self._global_hits.append(now)
        return True

    def _prune(self, now: float) -> None:
        cutoff = now - self.window
        self._global_hits = [t for t in self._global_hits if t > cutoff]
        for nid in list(self._node_hits):
            kept = [t for t in self._node_hits[nid] if t > cutoff]
            if kept:
                self._node_hits[nid] = kept
            else:
                del self._node_hits[nid]
