"""AI client — the onboard model over the OpenAI/Ollama-compatible API.

Uses the same `${NOMAD_OLLAMA_URL}` path `chat_service` / `rag_service` use, with
the LoRa system prompt and a short generation budget so answers fit on the radio.
Imported only by app.py (it needs httpx); the responder talks to the AIClient
Protocol, so the test suite never imports this module.
"""

from __future__ import annotations

import httpx

from .safety import LORA_SYSTEM_PROMPT


class OllamaAIClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        timeout_s: float = 30.0,
        max_answer_chars: int = 600,
        num_predict: int = 160,
    ):
        self._url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s
        self._max_chars = max_answer_chars
        self._num_predict = num_predict

    def ask(self, query: str) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": LORA_SYSTEM_PROMPT},
                {"role": "user", "content": query[: self._max_chars]},
            ],
            "stream": False,
            # Cap generation so the model answers short, not just so we truncate.
            "options": {"num_predict": self._num_predict},
        }
        resp = httpx.post(f"{self._url}/api/chat", json=payload, timeout=self._timeout)
        resp.raise_for_status()
        data = resp.json()
        return (data.get("message") or {}).get("content", "").strip()
