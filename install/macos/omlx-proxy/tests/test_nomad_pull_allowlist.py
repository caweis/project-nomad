import os, sys
import pytest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_OMLX_BASE"] = "http://omlx:8000"
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"

from src.routers import nomad_pull  # noqa: E402

_MAPPING = {"llama3.1:8b": "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit"}


@pytest.fixture(autouse=True)
def _stub_mappings(monkeypatch):
    """Make _resolve_mlx_repo see a fixed curated mapping, no real settings load."""
    class _Settings:
        def load_model_mappings(self):
            return _MAPPING

    monkeypatch.setattr(nomad_pull, "_get_settings", lambda: _Settings())


def test_mapped_name_resolves():
    assert nomad_pull._resolve_mlx_repo("llama3.1:8b") == _MAPPING["llama3.1:8b"]


def test_clean_mlx_community_repo_resolves():
    assert nomad_pull._resolve_mlx_repo("mlx-community/Foo-4bit") == "mlx-community/Foo-4bit"


def test_bare_basename_from_tags_resolves():
    # /api/tags lists the bare repo basename; pulling it must resolve back to
    # the curated mlx-community repo (symmetry: list == pullable).
    assert (
        nomad_pull._resolve_mlx_repo("Meta-Llama-3.1-8B-Instruct-4bit")
        == _MAPPING["llama3.1:8b"]
    )


def test_unknown_bare_basename_is_rejected():
    assert nomad_pull._resolve_mlx_repo("Totally-Not-A-Model-4bit") == ""


def test_pullable_lists_map_keys_excluding_comment():
    import asyncio
    res = asyncio.run(nomad_pull.pullable())
    assert res == {"models": ["llama3.1:8b"]}


@pytest.mark.parametrize(
    "name",
    [
        "mlx-community/../evil",  # path traversal
        "mlx-community/a/b",      # nested namespace (more than one '/')
        "mlx-community/x@h",      # char outside the safe set
        "random/repo",            # not curated, not mlx-community/
    ],
)
def test_unsafe_or_untrusted_names_are_rejected(name):
    assert nomad_pull._resolve_mlx_repo(name) == ""


def test_moe_tag_and_dwq_basename_resolve(monkeypatch):
    # An MoE key has a hyphenated tag ("30b-a3b") and a DWQ basename. Both the
    # exact key AND the bare repo basename /api/tags advertises must resolve
    # (the symmetry contract), exercising the reverse-lookup on a hyphen-heavy
    # basename — the curated Qwen3-30B-A3B MoE shape.
    mapping = {"qwen3:30b-a3b": "mlx-community/Qwen3-30B-A3B-4bit-DWQ"}

    class _Settings:
        def load_model_mappings(self):
            return mapping

    monkeypatch.setattr(nomad_pull, "_get_settings", lambda: _Settings())
    assert nomad_pull._resolve_mlx_repo("qwen3:30b-a3b") == "mlx-community/Qwen3-30B-A3B-4bit-DWQ"
    assert (
        nomad_pull._resolve_mlx_repo("Qwen3-30B-A3B-4bit-DWQ")
        == "mlx-community/Qwen3-30B-A3B-4bit-DWQ"
    )


def test_real_model_map_has_curated_moe_entries():
    # Guard the real curated config: the MoE / right-sized picks must stay mapped
    # to existing mlx-community repos, and every non-embedding value must be an
    # mlx-community repo (the proxy refuses anything else).
    import json
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[1] / "config" / "model_map.json"
    m = json.loads(path.read_text())
    assert m["qwen3:30b-a3b"] == "mlx-community/Qwen3-30B-A3B-4bit-DWQ"
    assert m["qwen3-coder:30b-a3b"] == "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"
    assert m["deepseek-v2:16b"] == "mlx-community/DeepSeek-V2-Lite-Chat-4bit-mlx"
    for key, value in m.items():
        if key == "_comment" or "embed" in key:
            continue
        assert value.startswith("mlx-community/"), f"{key} -> {value} is not an mlx-community repo"
