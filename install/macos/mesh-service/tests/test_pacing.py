"""AirtimePacer tests — fake clock + injected sleep, no real time elapses."""

import threading
import unittest

from mesh_service.pacing import AirtimePacer


class FakeClock:
    """Monotonic clock the test advances by hand."""

    def __init__(self, start: float = 0.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, dt: float) -> None:
        self.now += dt


class TestAirtimePacer(unittest.TestCase):
    def test_wait_returns_true_when_ack_already_set(self):
        clock = FakeClock()
        sleeps: list[float] = []
        pacer = AirtimePacer(ack_timeout_s=10, clock=clock, sleep=sleeps.append)
        ack = threading.Event()
        ack.set()  # pre-set: the ACK already arrived
        self.assertTrue(pacer.wait_for_ack_or_timeout(ack))

    def test_wait_returns_false_on_timeout_under_fake_clock(self):
        clock = FakeClock()
        # The pacer must consult the injected clock, not real wall time, so the
        # sleep step advances the fake clock past the deadline deterministically.
        def fake_sleep(dt: float) -> None:
            clock.advance(dt)

        pacer = AirtimePacer(ack_timeout_s=10, clock=clock, sleep=fake_sleep)
        ack = threading.Event()  # never set
        self.assertFalse(pacer.wait_for_ack_or_timeout(ack))
        self.assertGreaterEqual(clock.now, 10)

    def test_pace_fallback_calls_injected_sleep_once(self):
        calls: list[float] = []
        pacer = AirtimePacer(fallback_delay_s=2, sleep=calls.append)
        pacer.pace_fallback()
        self.assertEqual(calls, [2])


if __name__ == "__main__":
    unittest.main()
