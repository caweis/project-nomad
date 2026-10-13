"""Verify pinned model handling without a network request or ML runtime."""

import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import fetch_models


class ModelFetchTests(unittest.TestCase):
    def make_archive(self, path: Path, language="fr") -> str:
        with zipfile.ZipFile(path, "w") as package:
            prefix = "translate-en_fr-1_9/"
            package.writestr(prefix + "metadata.json", json.dumps({
                "from_code": "en", "to_code": language,
            }))
            package.writestr(prefix + "sentencepiece.model", b"tokenizer")
            package.writestr(prefix + "model/model.bin", b"model")
            package.writestr(prefix + "model/shared_vocabulary.json", b"[]")
            package.writestr("../../outside", b"untrusted extra")
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_only_pinned_languages_are_accepted(self):
        self.assertEqual(fetch_models.configured_languages("fr, es, FR,../tmp,de,pt"),
                         ["fr", "es", "de"])

    def test_extracts_only_expected_files_and_verifies_on_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "package.argosmodel"
            digest = self.make_archive(archive)
            target = root / "enfr"
            target.mkdir()
            fetch_models.extract(archive, "fr", target, digest)
            self.assertTrue(fetch_models.installed(target, digest))
            self.assertFalse((root / "outside").exists())
            (target / "model/model.bin").write_bytes(b"altered")
            self.assertFalse(fetch_models.installed(target, digest))

    def test_rejects_wrong_hash_and_language(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "package.argosmodel"
            digest = self.make_archive(archive, "de")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                fetch_models.extract(archive, "fr", root / "out", "0" * 64)
            with self.assertRaisesRegex(ValueError, "language"):
                fetch_models.extract(archive, "fr", root / "out", digest)

    def test_download_rejects_other_host_even_with_matching_bytes(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def geturl(self): return "https://evil.example/model"
            def read(self, _): return b"valid"

        with tempfile.TemporaryDirectory() as temporary:
            with patch("fetch_models.urllib.request.urlopen", return_value=Response()) as open_url:
                with self.assertRaisesRegex(ValueError, "trusted Argos host"):
                    fetch_models.download("https://argos-net.com/model", Path(temporary) / "model",
                                          hashlib.sha256(b"valid").hexdigest())
            self.assertIn("Project-NOMAD-Translate", open_url.call_args.args[0].get_header("User-agent"))


if __name__ == "__main__":
    unittest.main()
