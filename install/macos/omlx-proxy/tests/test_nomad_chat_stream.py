"""Regression: /api/chat streaming must carry text in `message.content`, not `response`.

The ollama JS client (used by the NOMAD admin chat UI) reads `chunk.message.content`
for /api/chat. The upstream ChatTranslator.translate_streaming_response ALWAYS emitted
generate-style `response`, so on the oMLX backend chat streamed an empty assistant
bubble (no error, no text). /api/generate must still use `response`. The non-streaming
translator already shaped by request type; this guards the streaming path to match.
"""
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
from src.translators.chat import ChatTranslator  # noqa: E402
from src.models import OllamaChatRequest, OllamaGenerateRequest  # noqa: E402

T = ChatTranslator()
OPENAI_CHUNK = {
    "model": "m",
    "choices": [{"delta": {"content": "Hello"}, "finish_reason": None}],
}


def _chat_req():
    return OllamaChatRequest(model="llama3.1:8b", messages=[{"role": "user", "content": "hi"}])


def _gen_req():
    return OllamaGenerateRequest(model="llama3.1:8b", prompt="hi")


def test_chat_stream_chunk_uses_message_content():
    out = T.translate_streaming_response(OPENAI_CHUNK, _chat_req())
    assert out["message"]["content"] == "Hello"
    assert out["message"]["role"] == "assistant"
    assert "response" not in out  # must NOT be generate-shaped


def test_chat_stream_done_chunk_has_message_not_response():
    out = T.translate_streaming_response("[DONE]", _chat_req(), is_last_chunk=True)
    assert out["done"] is True
    assert out["message"]["content"] == ""
    assert "response" not in out


def test_generate_stream_chunk_still_uses_response():
    out = T.translate_streaming_response(OPENAI_CHUNK, _gen_req())
    assert out["response"] == "Hello"
    assert "message" not in out


def test_generate_stream_done_chunk_still_uses_response():
    out = T.translate_streaming_response("[DONE]", _gen_req(), is_last_chunk=True)
    assert out["done"] is True
    assert out["response"] == ""
    assert "message" not in out


# --- Benchmark token-count regression (streaming) ------------------------------
# The admin's AI benchmark measures tok/s from the stream; it uses the done
# frame's eval_count when present, else counts SSE chunks (under-reports when the
# upstream batches >1 token per event). The proxy now stamps a real eval_count
# on the [DONE] frame. These pin: counts flow into the done frame, and the
# default (no counts) stays back-compatible (no eval_count key).


def test_done_frame_carries_eval_count_when_provided_chat():
    out = T.translate_streaming_response(
        "[DONE]", _chat_req(), is_last_chunk=True,
        eval_count=128, prompt_eval_count=11,
    )
    assert out["eval_count"] == 128
    assert out["prompt_eval_count"] == 11
    assert out["done"] is True
    assert "message" in out and "response" not in out


def test_done_frame_carries_eval_count_when_provided_generate():
    out = T.translate_streaming_response(
        "[DONE]", _gen_req(), is_last_chunk=True, eval_count=42,
    )
    assert out["eval_count"] == 42
    assert out["response"] == "" and "message" not in out


def test_done_frame_omits_eval_count_by_default():
    out = T.translate_streaming_response("[DONE]", _chat_req(), is_last_chunk=True)
    assert "eval_count" not in out  # back-compat: no count -> no key
    assert "prompt_eval_count" not in out
