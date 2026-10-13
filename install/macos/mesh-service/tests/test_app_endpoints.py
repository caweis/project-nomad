"""GET /status and GET /messages, plus the single-outbound-path guarantee.

Run against the MockAdapter-wired app via fastapi.testclient.TestClient. /status
reports adapter kind / model / ai_url / connected and a recent-message ring buffer;
/messages returns the bounded deque of recent inbound+outbound; /send still routes
through adapter.send_text (the one metered outbound path) and records to mock.sent.
"""

import asyncio
import threading
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import mesh_service.app as appmod
from mesh_service.adapter import Identity, IncomingMessage


class TestLifespanShutdown(unittest.TestCase):
    def test_shutdown_waits_for_responder_worker(self):
        exited = threading.Event()
        original_worker = appmod._worker

        def delayed_worker():
            try:
                original_worker()
            finally:
                time.sleep(0.1)
                exited.set()

        with patch.object(appmod, "_worker", delayed_worker):
            with TestClient(appmod.app):
                pass

        self.assertTrue(exited.is_set(), "lifespan returned before its responder worker exited")

    def test_failed_adapter_startup_stops_responder_worker(self):
        exited = threading.Event()
        worker_started = threading.Event()
        workers = []
        original_worker = appmod._worker

        def observed_worker():
            workers.append(threading.current_thread())
            worker_started.set()
            try:
                original_worker()
            finally:
                exited.set()

        try:
            with patch.object(appmod, "_worker", observed_worker):
                with patch.object(appmod.adapter, "connect", side_effect=RuntimeError("radio unavailable")):
                    with self.assertRaisesRegex(RuntimeError, "radio unavailable"):
                        async def start_app():
                            async with appmod.lifespan(appmod.app):
                                pass

                        asyncio.run(start_app())
            self.assertTrue(worker_started.is_set())
            self.assertTrue(exited.is_set(), "startup failure left the responder worker running")
        finally:
            if worker_started.is_set() and not exited.is_set():
                appmod._inbox.put(None)
                workers[0].join(timeout=1)


class TestStatusAndMessages(unittest.TestCase):
    def setUp(self):
        ai_patch = patch.object(appmod.ai, "ask", return_value="test answer")
        ai_patch.start()
        self.addCleanup(ai_patch.stop)
        # TestClient's context manager runs lifespan (starts the worker, connects).
        self.client = TestClient(appmod.app)
        self.client.__enter__()
        appmod.recent_messages.clear()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_status_reports_adapter_model_and_connected(self):
        body = self.client.get("/status").json()
        self.assertEqual(body["adapter"], appmod.config.adapter_kind)
        self.assertEqual(body["model"], appmod.config.model)
        self.assertEqual(body["ai_url"], appmod.config.ollama_url)
        self.assertTrue(body["connected"])  # lifespan called adapter.connect()
        self.assertIn("recent", body)
        self.assertIsInstance(body["recent"], list)

    def test_injected_inbound_message_appears_in_messages(self):
        appmod.record_inbound(
            IncomingMessage("how do I purify water", Identity("mock", "!bob", "Bob"), is_direct=True)
        )
        msgs = self.client.get("/messages").json()["messages"]
        self.assertTrue(any(m["direction"] == "in" and "purify" in m["text"] for m in msgs))

    def test_send_appends_to_mock_sent_and_records_outbound(self):
        before = len(appmod.adapter.sent)
        resp = self.client.post("/send", json={"to": "!bob", "body": "hello there"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(appmod.adapter.sent), before + 1)
        self.assertEqual(appmod.adapter.sent[-1][1], "hello there")
        # And the outbound shows up in the ring buffer.
        msgs = self.client.get("/messages").json()["messages"]
        self.assertTrue(any(m["direction"] == "out" and m["text"] == "hello there" for m in msgs))

    def test_messages_ring_buffer_is_bounded(self):
        for i in range(appmod.RECENT_MESSAGES_MAX + 25):
            appmod.record_inbound(
                IncomingMessage(f"msg {i}", Identity("mock", "!bob"), is_direct=True)
            )
        msgs = self.client.get("/messages").json()["messages"]
        self.assertLessEqual(len(msgs), appmod.RECENT_MESSAGES_MAX)

    def test_send_is_the_only_outbound_path(self):
        # Regression guard: there is exactly one route that calls adapter.send_text.
        # If a second unmetered send endpoint is ever added, this count changes.
        send_routes = [
            r for r in appmod.app.routes
            if getattr(r, "path", None) == "/send" and "POST" in getattr(r, "methods", set())
        ]
        self.assertEqual(len(send_routes), 1)


if __name__ == "__main__":
    unittest.main()
