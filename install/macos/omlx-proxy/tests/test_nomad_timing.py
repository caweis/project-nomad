"""Regression: the proxy MUST report the REAL generation wall-clock time.

The admin's AI benchmark computes:

    tokens/sec = eval_count / (eval_duration / 1e9)

For non-streaming /api/generate and /api/chat the OpenAI-style oMLX response
carries token counts but NO durations, so the translator used to HARDCODE
total_duration=1e9, prompt_eval_duration=0.5e9, eval_duration=0.5e9. With a faked
0.5s denominator the reported speed was a pure artifact (e.g. ~396 tok/s) and TTFT
was a fake 500ms — while oMLX's real short-prompt throughput is ~115 tok/s.

The proxy makes the oMLX call, so it can measure wall-clock time and thread it in
as `elapsed_ns`. When provided, eval_duration/total_duration become the real time
and prompt_eval_duration is reported as 0 (the OpenAI API exposes no prefill time —
report unknown rather than fabricate). When omitted, the legacy placeholders are
preserved for back-compat. This test guards both behaviors.
"""
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

from src.models import (  # noqa: E402
    OllamaGenerateRequest,
    OpenAIChatResponse,
    OpenAIChoice,
    OpenAIMessage,
    OpenAIUsage,
)
from src.translators.chat import ChatTranslator  # noqa: E402


def _build_response() -> OpenAIChatResponse:
    """A minimal non-streaming OpenAI chat response with token usage."""
    return OpenAIChatResponse(
        model="qwen2.5:7b",
        choices=[
            OpenAIChoice(
                index=0,
                message=OpenAIMessage(role="assistant", content="Hello, world."),
                finish_reason="stop",
            )
        ],
        usage=OpenAIUsage(
            prompt_tokens=40,
            completion_tokens=200,
            total_tokens=240,
        ),
    )


def _build_request() -> OllamaGenerateRequest:
    return OllamaGenerateRequest(model="qwen2.5:7b", prompt="hi", stream=False)


def test_elapsed_ns_reports_real_throughput():
    """With a measured elapsed time, durations reflect real decode speed."""
    translator = ChatTranslator()
    resp = _build_response()

    out = translator.translate_response(
        resp, original_request=_build_request(), elapsed_ns=1_750_000_000
    )

    # Real wall-clock time flows through; the legacy 0.5e9 placeholder is gone.
    assert out.eval_duration == 1_750_000_000
    assert out.total_duration == 1_750_000_000
    # OpenAI API exposes no prefill time → report unknown, don't fabricate.
    assert out.prompt_eval_duration == 0
    assert out.eval_count == 200

    # The benchmark's tok/s now reflects reality: 200 tokens / 1.75s ≈ 114 tok/s,
    # matching oMLX's own ~115 tok/s — NOT the old ~396 tok/s artifact.
    tok_per_sec = out.eval_count / (out.eval_duration / 1e9)
    assert 100 < tok_per_sec < 130


def test_no_elapsed_ns_preserves_legacy_placeholders():
    """Back-compat: callers that don't measure still get the legacy placeholders."""
    translator = ChatTranslator()
    resp = _build_response()

    out = translator.translate_response(resp, original_request=_build_request())

    assert out.eval_duration == int(0.5e9)
    assert out.prompt_eval_duration == int(0.5e9)
    assert out.total_duration == int(1e9)
    assert out.eval_count == 200
