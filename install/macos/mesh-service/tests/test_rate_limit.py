"""Tests for the sliding-window rate limiter."""

import unittest

from mesh_service.rate_limit import RateLimiter


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt


class TestRateLimiter(unittest.TestCase):
    def test_per_node_cap(self):
        clock = FakeClock()
        rl = RateLimiter(per_node_per_min=2, global_per_min=99, clock=clock)
        self.assertTrue(rl.allow("a"))
        self.assertTrue(rl.allow("a"))
        self.assertFalse(rl.allow("a"))  # third within the window is refused
        # A different node is unaffected.
        self.assertTrue(rl.allow("b"))

    def test_global_cap_across_nodes(self):
        clock = FakeClock()
        rl = RateLimiter(per_node_per_min=99, global_per_min=3, clock=clock)
        self.assertTrue(rl.allow("a"))
        self.assertTrue(rl.allow("b"))
        self.assertTrue(rl.allow("c"))
        self.assertFalse(rl.allow("d"))  # global window full

    def test_window_expiry_frees_capacity(self):
        clock = FakeClock()
        rl = RateLimiter(per_node_per_min=1, global_per_min=99, window_s=60, clock=clock)
        self.assertTrue(rl.allow("a"))
        self.assertFalse(rl.allow("a"))
        clock.advance(61)  # past the window
        self.assertTrue(rl.allow("a"))


if __name__ == "__main__":
    unittest.main()
