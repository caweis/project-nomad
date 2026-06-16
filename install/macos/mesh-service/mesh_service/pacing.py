"""Airtime pacing for the half-duplex LoRa link.

LoRa is slow and shared, so the bridge waits for each part's delivery ACK before
sending the next — and when a protocol gives no ACK (or the ACK never comes), it
paces with a small fixed delay instead so it never floods the channel. Both the
clock and the sleep are injected, so tests drive timing deterministically with no
real airtime elapsed.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable


class AirtimePacer:
    def __init__(
        self,
        ack_timeout_s: float = 10.0,
        fallback_delay_s: float = 2.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.ack_timeout_s = ack_timeout_s
        self.fallback_delay_s = fallback_delay_s
        self._clock = clock
        self._sleep = sleep

    def wait_for_ack_or_timeout(self, ack_event: threading.Event) -> bool:
        """Block until `ack_event` is set or the timeout elapses.

        Returns True if the ACK arrived, False on timeout. Polls the event in
        short steps and consults the injected clock for the deadline, so a fake
        clock + fake sleep make the timeout path fully deterministic in tests
        (Event.wait alone would burn real wall-clock time).
        """
        if ack_event.is_set():
            return True
        deadline = self._clock() + self.ack_timeout_s
        step = min(0.25, self.ack_timeout_s)
        while self._clock() < deadline:
            if ack_event.wait(0):
                return True
            self._sleep(step)
        return ack_event.is_set()

    def pace_fallback(self) -> None:
        """Sleep one fixed inter-part delay when no ACK is available to gate on."""
        self._sleep(self.fallback_delay_s)
