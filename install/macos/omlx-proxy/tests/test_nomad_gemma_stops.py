"""Regression: gemma-family chats MUST carry a default stop sequence.

Seen live on the mini (gemma3:1b via oMLX): the model finished its answer,
emitted its chat-template turn delimiter "<end_of_turn>", and oMLX kept
generating looping garbage until the token limit because that delimiter is not
registered as an end-of-sequence token. The translator now injects the family's
default stop when the client supplied none. These tests pin:
(1) gemma models get ["<end_of_turn>"] injected,
(2) non-gemma models get no injected stop,
(3) an explicit client stop is never overridden.
"""
import os
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")

from src.models import OllamaChatRequest, OllamaOptions  # noqa: E402
from src.translators.chat import ChatTranslator, default_stops_for_model  # noqa: E402


def _chat_request(model: str, options=None) -> OllamaChatRequest:
    return OllamaChatRequest(
        model=model,
        messages=[{"role": "user", "content": "what's the best home remedy for a fever"}],
        stream=False,
        options=options,
    )


def test_default_stops_lookup():
    assert default_stops_for_model("gemma3:1b") == ["<end_of_turn>"]
    assert default_stops_for_model("GEMMA2:9b") == ["<end_of_turn>"]
    assert default_stops_for_model("qwen3:30b-a3b") is None
    assert default_stops_for_model("llama3.1:8b") is None


def test_gemma_chat_gets_injected_stop():
    translator = ChatTranslator()
    openai_request = translator.translate_request(_chat_request("gemma3:1b"))
    assert openai_request.stop == ["<end_of_turn>"]


def test_non_gemma_chat_gets_no_injected_stop():
    translator = ChatTranslator()
    openai_request = translator.translate_request(_chat_request("qwen3:30b-a3b"))
    assert openai_request.stop is None


def test_explicit_client_stop_wins():
    translator = ChatTranslator()
    openai_request = translator.translate_request(
        _chat_request("gemma3:1b", options=OllamaOptions(stop=["CUSTOM"]))
    )
    assert openai_request.stop == ["CUSTOM"]
