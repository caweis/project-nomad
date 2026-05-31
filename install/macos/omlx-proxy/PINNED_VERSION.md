# Vendored proxy: eyalrot/ollama_openai

- **Upstream:** https://github.com/eyalrot/ollama_openai (MIT)
- **Pinned commit:** 2ac0fd6c818cc33565e00ea2da01d84e5d176083 (master, fetched 2026-05-31)
- **Why vendored:** we add an oMLX-aware `/api/pull` and route `/api/embeddings`
  to a local embed-only Ollama. A small controlled copy is simpler than
  pip-install + monkeypatch.

## Our changes on top of upstream
- `vendor/src/routers/nomad_pull.py` (NEW) — `/api/pull` → oMLX `/api/hf/download`.
- `vendor/src/routers/nomad_embed.py` (NEW) — `/api/embeddings` → embed Ollama (:11435).
- `vendor/src/main.py` — register the two routers ahead of upstream's `/api` routes.
- `../config/model_map.json` — Ollama tag → mlx-community repo (MODEL_MAPPING_FILE).

Upstream already provides `/api/tags`, `/api/show`, `/api/version`, `/api/chat`,
`/api/generate` — unchanged.
