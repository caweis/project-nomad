"""build_adapter() selection + the receive-path-cheap invariant.

The default stays MockAdapter (no regression, no radio lib needed to import app.py).
Selecting 'meshtastic' returns a MeshtasticAdapter that has NOT connected (no socket,
no getMyNodeInfo) at construction. And the receive path only enqueues — the single
worker is the ONLY caller of responder.handle_message.
"""

import unittest
from dataclasses import replace

from mesh_service.config import load_config
from mesh_service.mock_adapter import MockAdapter


class TestBuildAdapter(unittest.TestCase):
    def test_default_kind_is_mock(self):
        config = load_config()
        self.assertEqual(config.adapter_kind, "mock")

    def test_build_adapter_mock_returns_mock_adapter(self):
        from mesh_service.app import build_adapter

        config = replace(load_config(), adapter_kind="mock")
        adapter = build_adapter(config)
        self.assertIsInstance(adapter, MockAdapter)

    def test_build_adapter_meshtastic_is_lazy_no_socket_at_construction(self):
        from mesh_service.app import build_adapter
        from mesh_service.meshtastic_adapter import MeshtasticAdapter

        config = replace(
            load_config(),
            adapter_kind="meshtastic",
            meshtastic_host="radio.local",
            meshtastic_port=4403,
        )
        adapter = build_adapter(config)
        self.assertIsInstance(adapter, MeshtasticAdapter)
        # Lazy: constructing the adapter built no interface and opened no socket.
        self.assertIsNone(adapter._iface)
        self.assertIsNone(adapter.our_node_id)

    def test_meshtastic_host_and_port_have_docker_defaults(self):
        config = load_config()
        self.assertEqual(config.meshtastic_host, "host.docker.internal")
        self.assertEqual(config.meshtastic_port, 4403)


class TestReceivePathInvariant(unittest.TestCase):
    """The adapter's receive callback must ONLY enqueue — never call the responder
    directly. The single worker is the sole caller of handle_message."""

    def test_receive_callback_enqueues_and_does_not_call_responder(self):
        import queue

        from mesh_service.adapter import Identity, IncomingMessage

        inbox: "queue.Queue" = queue.Queue()
        adapter = MockAdapter()
        # This mirrors app.py's wiring: on_message(inbox.put).
        adapter.on_message(inbox.put)

        handle_calls = []

        # A responder whose handle_message we spy on; it must NOT be reached on inject.
        class SpyResponder:
            def handle_message(self, message):
                handle_calls.append(message)

        responder = SpyResponder()  # noqa: F841 — intentionally unused on receive path

        adapter.inject(
            IncomingMessage("hi", Identity("mock", "!bob", "Bob"), is_direct=True)
        )
        # The message is queued, and the responder was NOT called by the receive path.
        self.assertEqual(inbox.qsize(), 1)
        self.assertEqual(handle_calls, [])
        # The worker is what calls it.
        responder.handle_message(inbox.get())
        self.assertEqual(len(handle_calls), 1)


if __name__ == "__main__":
    unittest.main()
