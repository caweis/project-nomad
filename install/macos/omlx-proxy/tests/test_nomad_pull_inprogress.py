import os
import sys
from pathlib import Path

import pytest

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_OMLX_BASE"] = "http://omlx:8000"
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"

from src.routers import nomad_pull  # noqa: E402


def test_409_is_already_running():
    # Pre-existing behavior: 409 means the download is in flight.
    assert nomad_pull._download_already_running(409, "Conflict") is True


@pytest.mark.parametrize(
    "body",
    [
        "Download for 'mlx-community/Hermes-4-14B-4bit' is already in progress",
        "ALREADY IN PROGRESS",  # case-insensitive
        "{\"detail\":\"Download for 'X' is already in progress\"}",
    ],
)
def test_400_already_in_progress_is_benign(body):
    # The fix: a 400 whose body says "already in progress" must NOT be a failure.
    assert nomad_pull._download_already_running(400, body) is True


def test_400_other_error_is_not_benign():
    # A genuine 400 (e.g. bad repo) must still surface as an error.
    assert nomad_pull._download_already_running(400, "repo not found") is False


@pytest.mark.parametrize("status", [401, 403, 404, 500, 502])
def test_other_4xx_5xx_not_treated_as_running(status):
    assert nomad_pull._download_already_running(status, "already in progress") is False


def test_empty_body_does_not_crash():
    assert nomad_pull._download_already_running(400, "") is False
    assert nomad_pull._download_already_running(400, None) is False
