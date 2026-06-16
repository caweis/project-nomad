"""MeshCoreAdapter scaffold tests — runs on plain python3 (meshcore NOT installed).

P3 is a scaffold only: meshcore-py is Beta and a point release broke receive (#81),
so the adapter must REFUSE to construct unless the operator explicitly opts in via
MESH_ENABLE_MESHCORE=1. The capability descriptors (from research) and ABC
conformance are pinned here; the real async wiring is a documented contract, not
called code.
"""

import os
import unittest
from unittest import mock

from mesh_service.adapter import MeshAdapter
from mesh_service.meshcore_adapter import MeshCoreAdapter


class TestMeshCoreAdapterScaffold(unittest.TestCase):
    def test_is_a_mesh_adapter_subclass(self):
        self.assertTrue(issubclass(MeshCoreAdapter, MeshAdapter))

    def test_implements_the_abc_surface(self):
        # No abstractmethods left unimplemented (else it couldn't subclass cleanly).
        self.assertEqual(MeshCoreAdapter.__abstractmethods__, frozenset())

    def test_construction_without_optin_raises_not_implemented(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(NotImplementedError) as ctx:
                MeshCoreAdapter("radio.local")
        self.assertIn("experimental", str(ctx.exception).lower())

    def test_construction_with_optin_is_allowed(self):
        with mock.patch.dict(os.environ, {"MESH_ENABLE_MESHCORE": "1"}, clear=True):
            adapter = MeshCoreAdapter("radio.local", port=4000)
            self.assertIsInstance(adapter, MeshAdapter)

    def test_capability_descriptors_match_research(self):
        self.assertEqual(MeshCoreAdapter.identity_kind, "pubkey_prefix")
        # MeshCore publishes no fixed payload number — we enforce a conservative cap.
        self.assertLessEqual(MeshCoreAdapter.max_text_bytes, 133)
        self.assertGreater(MeshCoreAdapter.max_text_bytes, 0)
        self.assertTrue(MeshCoreAdapter.ack_support)


if __name__ == "__main__":
    unittest.main()
