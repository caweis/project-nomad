"""Regression: /api/show MUST return a `capabilities` array.

The admin's OllamaService.checkModelHasThinking() runs before every chat and does:

    modelInfo.capabilities.includes('thinking')

with NO null guard. The upstream proxy's OllamaShowResponse omitted `capabilities`,
so on the oMLX backend `modelInfo.capabilities` was `undefined` → TypeError. The
admin's streaming chat handler swallows that as `data:{"error":true}`, so every RAG
chat failed with "Sorry, there was an error" — while direct /api/chat and embeddings
worked fine (they never call /api/show). This test guards against that regression.
"""
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
from src.models import OllamaShowResponse  # noqa: E402


def test_show_response_serializes_capabilities_list():
    r = OllamaShowResponse(modelfile="", parameters="", template="", details={})
    dumped = r.model_dump()
    # Must be PRESENT and a list so a JS client's `.includes(...)` never throws.
    assert "capabilities" in dumped
    assert isinstance(dumped["capabilities"], list)
    assert "completion" in dumped["capabilities"]


def test_capabilities_default_is_completion_only():
    # We intentionally do NOT advertise "thinking": that would make the admin send
    # Ollama's `think` param, which oMLX's OpenAI-style API rejects.
    r = OllamaShowResponse(modelfile="x", parameters="x", template="x", details={})
    assert r.capabilities == ["completion"]
    assert "thinking" not in r.capabilities
