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
