"""CPU translation with local Argos CTranslate2 model packages."""

import os
import re
import threading
from pathlib import Path

MODELS = Path(os.environ.get("MODELS", "/models"))
THREADS = max(1, min(8, int(os.environ.get("WORKERS", "4"))))
MAX_SOURCE_TOKENS = 180

_loaded = {}
_load_lock = threading.Lock()


def model_ready(pair: str) -> bool:
    root = MODELS / pair
    return (root / "sentencepiece.model").is_file() and (root / "model/model.bin").is_file()


def _load(pair: str):
    if not re.fullmatch(r"en[a-z]{2}", pair) or not model_ready(pair):
        raise ValueError(f"Translation model unavailable: {pair}")
    with _load_lock:
        if pair not in _loaded:
            import ctranslate2
            import sentencepiece

            root = MODELS / pair
            tokenizer = sentencepiece.SentencePieceProcessor(
                model_file=str(root / "sentencepiece.model")
            )
            translator = ctranslate2.Translator(
                str(root / "model"), device="cpu", inter_threads=1,
                intra_threads=THREADS,
            )
            _loaded[pair] = (tokenizer, translator)
    return _loaded[pair]


def _decode(tokenizer, tokens: list[str]) -> str:
    # Argos' SentencePiece wrapper replaces the visible U+2581 space marker.
    return tokenizer.decode_pieces(tokens).replace("▁", " ").replace("_", " ").strip()


def translate_blocks(pair: str, jobs: list[str]) -> list[str]:
    """Translate text nodes in batches, preserving each node's outer whitespace."""
    if not jobs:
        return []
    tokenizer, translator = _load(pair)
    batches = []
    layout = []
    for text in jobs:
        match = re.fullmatch(r"(\s*)(.*?)(\s*)", text, re.DOTALL)
        assert match is not None
        before, core, after = match.groups()
        tokens = tokenizer.encode(core, out_type=str)
        chunks = [tokens[i:i + MAX_SOURCE_TOKENS]
                  for i in range(0, len(tokens), MAX_SOURCE_TOKENS)]
        layout.append((before, after, len(chunks)))
        batches.extend(chunks)
    translations = translator.translate_batch(
        batches, replace_unknowns=True, max_batch_size=16, batch_type="tokens",
        beam_size=4, length_penalty=0.2,
    )
    result = []
    offset = 0
    for before, after, count in layout:
        pieces = [_decode(tokenizer, item.hypotheses[0])
                  for item in translations[offset:offset + count]]
        result.append(before + " ".join(pieces) + after)
        offset += count
    return result
