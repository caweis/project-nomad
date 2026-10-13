#!/usr/bin/env python3
"""Fetch pinned Argos model archives for offline English article translation."""

import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

MODELS = Path(os.environ.get("MODELS", "/models"))
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_MODEL_BYTES = 256 * 1024 * 1024

# These archives are listed by the Argos package index. Pinning their content
# avoids silently accepting a changed model on a later container restart.
PACKAGES = {
    "fr": ("translate-en_fr-1_9", "3a65ed83364f4e7b06e30f9dd823db1934899ed3ce839e63f46dc7b09dc797b4"),
    "es": ("translate-en_es-1_0", "d698d0ef87ad70d5d184b7fa6965905bf4368f09a2bb9ffb165a79bac96af0c4"),
    "de": ("translate-en_de-1_3", "6cd847f0c06c9c66013e6b0932e07fd54a6d90894659c02bf6c5247b72fb25b1"),
}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def configured_languages(raw: str) -> list[str]:
    languages = []
    for entry in raw.split(","):
        code = entry.strip().lower()
        if code in PACKAGES and code not in languages:
            languages.append(code)
        elif code:
            print(f"Skipping unsupported or duplicate translation language: {code}", flush=True)
    return languages


def installed(root: Path, expected_archive_hash: str) -> bool:
    try:
        manifest = json.loads((root / "manifest.json").read_text())
        if manifest["archive_sha256"] != expected_archive_hash:
            return False
        for name, digest in manifest["files"].items():
            if name.startswith("/") or ".." in Path(name).parts:
                return False
            path = root / name
            if path.is_symlink() or not path.is_file() or file_hash(path) != digest:
                return False
        return {"sentencepiece.model", "model/model.bin"} <= set(manifest["files"])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def download(url: str, destination: Path, expected_hash: str) -> None:
    digest = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={
        "User-Agent": "Project-NOMAD-Translate/0.1 (https://github.com/caweis/project-nomad)",
    })
    with urllib.request.urlopen(request, timeout=120) as response:
        final = urllib.parse.urlparse(response.geturl())
        if final.scheme != "https" or final.hostname != "argos-net.com":
            raise ValueError("Model download left the trusted Argos host")
        with destination.open("wb") as output:
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise ValueError("Model archive exceeds download limit")
                digest.update(chunk)
                output.write(chunk)
    if digest.hexdigest() != expected_hash:
        raise ValueError("Model archive SHA-256 mismatch")


def extract(archive: Path, language: str, destination: Path, expected_hash: str) -> None:
    """Copy only the translator's data files; ignore archive paths and extras."""
    if file_hash(archive) != expected_hash:
        raise ValueError("Model archive SHA-256 mismatch")
    with zipfile.ZipFile(archive) as package:
        names = {item.filename: item for item in package.infolist()}
        metadata_names = [name for name in names if name.endswith("/metadata.json")]
        if len(metadata_names) != 1:
            raise ValueError("Model archive has no unique metadata")
        prefix = metadata_names[0][:-len("metadata.json")]
        if not re.fullmatch(r"[A-Za-z0-9_-]+/", prefix):
            raise ValueError("Model archive has an unsafe root")
        metadata = json.loads(package.read(prefix + "metadata.json"))
        if metadata.get("from_code") != "en" or metadata.get("to_code") != language:
            raise ValueError("Model archive language does not match")
        required = ["sentencepiece.model", "model/model.bin"]
        vocabulary = [name for name in ("model/shared_vocabulary.json", "model/shared_vocabulary.txt")
                      if prefix + name in names]
        if len(vocabulary) != 1:
            raise ValueError("Model archive vocabulary is missing or ambiguous")
        selected = required + vocabulary
        if prefix + "model/config.json" in names:
            selected.append("model/config.json")
        if any(prefix + name not in names for name in required):
            raise ValueError("Model archive is incomplete")
        if sum(names[prefix + name].file_size for name in selected) > MAX_MODEL_BYTES:
            raise ValueError("Extracted model exceeds size limit")
        hashes = {}
        for name in selected:
            info = names[prefix + name]
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Model archive contains a symbolic link")
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with package.open(info) as source, path.open("wb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            hashes[name] = file_hash(path)
        (destination / "manifest.json").write_text(json.dumps({
            "archive_sha256": expected_hash, "files": hashes,
        }, sort_keys=True))


def install(language: str, root: Path = MODELS) -> None:
    archive_name, expected_hash = PACKAGES[language]
    target = root / ("en" + language)
    if target.is_symlink():
        raise ValueError("Model directory must not be a symbolic link")
    if installed(target, expected_hash):
        print(f"  en{language}: verified existing model", flush=True)
        return
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".en{language}-", dir=root) as temporary:
        workspace = Path(temporary)
        archive = workspace / "package.argosmodel"
        url = f"https://argos-net.com/v1/{archive_name}.argosmodel"
        print(f"  en{language}: downloading pinned Argos model", flush=True)
        download(url, archive, expected_hash)
        staged = workspace / "staged"
        staged.mkdir()
        extract(archive, language, staged, expected_hash)
        backup = workspace / "previous"
        if target.exists():
            target.rename(backup)
        try:
            staged.rename(target)
        except Exception:
            if backup.exists():
                backup.rename(target)
            raise
    print(f"  en{language}: installed and verified", flush=True)


if __name__ == "__main__":
    languages = configured_languages(os.environ.get("TRANSLATE_LANGS", "fr,es,de"))
    for code in languages:
        try:
            install(code)
        except Exception as exc:
            print(f"  en{code}: model unavailable ({exc})", flush=True)
