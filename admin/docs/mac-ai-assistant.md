# AI & Local Models

On the Mac edition, NOMAD's AI runs **natively on your Mac** — on Apple Silicon's Metal GPU — instead of inside a Docker container. You can use the built-in assistant, run your own local models alongside it, and point desktop apps at the same models. This page covers all of it.

---

## Two engines: Ollama and Apple MLX

NOMAD can run its chat AI on either of two local engines. Check or switch with:

```
nomad backend show      # which engine is active
nomad backend omlx      # Apple MLX (Metal) — needs Apple Silicon, macOS 15+
nomad backend ollama    # native Ollama (Metal)
```

- **`ollama`** — Ollama serves both chat and embeddings on `:11434`, Metal-accelerated. Works on any supported Mac.
- **`omlx`** — Apple's MLX framework serves chat (higher throughput on Apple Silicon) on `:8000`, behind an Ollama-compatible proxy on `:11436` that the Command Center talks to. A small Ollama on `:11435` serves the embeddings used for document search (RAG), and your own general Ollama models run alongside on `:11434`.

Switching backends preserves your models on disk both ways — MLX weights and Ollama weights coexist, so switching back doesn't re-download anything. Whichever engine is active, the chat interface (`/chat`), the installed-model list, and document upload (RAG) all work the same.

---

## Why native (not Docker)

Most server software on macOS runs inside Docker, which on Apple Silicon means a Linux virtual machine — isolated from the Metal GPU. NOMAD runs the AI engine directly on your Mac instead:

- **Inference runs on the GPU**, several times faster than CPU-only.
- **Unified memory works as intended** — big models load without copying through a VM.
- **No Rosetta translation** — native ARM64.

---

## Where the models live

- **Ollama models** you pull live at `~/.ollama/models` (your own/general models). On the `ollama` backend they live on your data drive at `<your-data-drive>/project-nomad/ollama-models/` instead.
- **MLX weights** (oMLX backend) live on your data drive at `<your-data-drive>/project-nomad/mlx-models/`.
- **The embedding model** for RAG is kept on the internal disk, so document search keeps working even if you unplug the data drive.

Putting large models on an external SSD keeps your Mac's boot drive from filling up (a `dreamy` tier is well over 200 GB), and Ollama treats the model directory as the source of truth — replug the drive on another NOMAD Mac and the models come along.

See your installed models from Terminal with `nomad models`, or in the Command Center under **Settings → AI**.

---

## Switching chat models

The assistant uses one model at a time for chat. Change it from **Settings → AI** in the Command Center, or from the chat interface. To pull a model that isn't downloaded yet:

```
nomad models pull llama3.1:8b
```

…or pick one from the available-models list in **Settings → AI** and it queues a download.

---

## Tier presets

When you installed NOMAD, the installer offered a tier — a curated model set sized to your RAM:

| Tier | RAM | What you get |
|---|---|---|
| `tiny` | 8 GB | Two small chat models plus an embedding model. Conversation works; reasoning is limited. |
| `small` | 16 GB | An 8B chat model, a coding model, a small Google model, embeddings. Capable. |
| `medium` | 32 GB | Two 14B models for chat and code, a 12B Google model, embeddings. A good default for an M-series Pro. |
| `large` | 64 GB | A 32B coding model, a 27B chat model, a 24B Mistral, embeddings. Studio territory. |
| `xl` | 128 GB | Adds a 70B model and a deep-reasoning model. Maxed-out Studios. |
| `dreamy` | 192+ GB | The whole pantry, for absurdly capable Macs. |

Pull a different tier any time with `nomad models pull large` — it adds to what you already have (nothing is removed).

---

## Chat & connect apps

**Built-in chat (recommended).** NOMAD includes **Open WebUI** — a polished, ChatGPT-style chat over your local models — at **`http://nomad.local:3000`** from any device on your network. Nothing to install; the appliance manages it. First visit creates a local account (first user = admin).

To connect *other* tools (a coding agent, a notebook, your own scripts), NOMAD also exposes standard local-AI APIs you can point them at:

- **Ollama API** at `http://localhost:11434`. In oMLX mode, the MLX chat engine is also reachable through the Ollama-compatible proxy at `http://localhost:11436`.
- **OpenAI / Anthropic-compatible API** (oMLX) at `http://localhost:8000`.

Point any tool that speaks the Ollama or OpenAI API (for example Open WebUI) at those URLs, pull whatever model you want with `nomad models pull <name>`, and select it in the app. Model choice is yours — NOMAD doesn't auto-pull.

**Local vs. your network:**

- **On this Mac** — use the `localhost` URLs above; nothing leaves the machine.
- **From another device on your LAN** — use `http://nomad.local:<port>` once network access is enabled (Settings → AI). ⚠️ **A local model server is unauthenticated** — anyone on the network could use (and pull or delete) your models. Only enable this on a network you trust.
- **Over an untrusted network** — don't expose the port; tunnel instead, e.g. `ssh -L 11434:localhost:11434 you@nomad.local`, or use Tailscale.

**On model size:** a local 8B model is genuinely useful, but it is not Claude- or GPT-class. Larger local models (14B–70B) reason noticeably better but need proportionally more RAM — pick one that fits your Mac (see the tier table above).

---

## Updating the AI

The AI engine updates separately from the Command Center, and **which command to use depends on your backend**:

- **On `omlx`** (Apple MLX is your chat engine): `nomad upgrade omlx` — or click **Update AI Assistant** in **Settings → Updates**, which is backend-aware and runs the right command for you.
- **On `ollama`**: `nomad upgrade ollama`.

Your downloaded models keep working across updates.

> **Troubleshooting — "llama-server binary not found":** on macOS 26 the Homebrew Ollama *formula* ships without the llama.cpp inference runner, which makes model loads fail while the daemon still answers. NOMAD runs Ollama from the official **Ollama.app** binary (which includes a working runner) to avoid this. If chat or RAG reports a missing runner, install the official app — `brew install --cask ollama` or [ollama.com/download/mac](https://ollama.com/download/mac) — then run `nomad reset-ollama`.

---

## What's NOT how it works

A few things people sometimes ask about:

- **The "Reinstall AI Assistant" button** in upstream NOMAD tries to recreate an AI container. On the Mac edition there is no container to recreate, so it's hidden — restart the AI with `nomad reset-ollama` from Terminal.
- **The "Update Available" message** in Settings → Updates refers to the Command Center itself, not the AI engine. Update the engine with the backend-aware command above; update the Command Center with `nomad upgrade admin` (see [Updating](/docs/mac-updates)).
- **There's no GPU passthrough to configure.** The engine uses Apple Silicon's GPU automatically — every M-series chip has one.
