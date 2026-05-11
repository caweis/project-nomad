# AI Assistant on Mac

On the Mac edition, the AI Assistant runs natively on your Mac instead of inside a Docker container. This isn't a small detail — it's the difference between having access to Apple Silicon's GPU or not.

---

## How it's different

Most server software on macOS runs inside Docker, which on Apple Silicon means running inside a Linux virtual machine. That works fine for things like databases or web servers, but it isolates the software from the Metal GPU that makes AI on Apple Silicon fast.

The Mac edition runs Ollama (the AI Assistant's engine) directly on your Mac via Homebrew. The Command Center inside Docker talks to it at `http://host.docker.internal:11434`. The practical effect:

- **Inference runs on the GPU**, not just the CPU. Token generation is several times faster.
- **The unified memory architecture works as intended** — Ollama can load big models without copying data in and out of a virtualized environment.
- **No Rosetta translation** — Ollama runs as a native ARM64 binary.

Everything else about the AI Assistant works the same way it does on Linux. The chat interface is at `/chat`. Models you've installed show up there. Document upload (RAG) works. The Command Center API to chat with the AI Assistant is the same.

---

## Where the models live

By default, your installed models are at `<your-data-drive>/project-nomad/ollama-models/`. The installer points Ollama at this directory via the `OLLAMA_MODELS` environment variable.

This means:

- **You can move them between Macs.** Plug your data drive into another Mac running N.O.M.A.D. and the models come along.
- **Your boot drive doesn't fill up.** A `dreamy` tier install is well over 200 GB — putting that on an external SSD keeps your Mac's internal drive happy.
- **A model you removed elsewhere comes back when you replug.** Ollama treats the directory as the source of truth.

You can see your installed models from Terminal:

```
nomad models
```

or in the Command Center under **Settings → AI Assistant**.

---

## Switching models

The AI Assistant uses one model at a time for chat. You can change which one from **Settings → AI Assistant → Chat Model**, or via the chat interface itself.

If a model isn't downloaded yet, you can pull it from Terminal:

```
nomad models pull llama3.1:8b
```

…or in the Command Center, **Settings → AI Assistant → Available Models**, click the model you want, and it queues a download.

---

## Tier presets

When you installed N.O.M.A.D., the installer asked you to pick a tier. Each tier is a curated set of models that fit comfortably in a given RAM size:

| Tier | RAM | What you get |
|---|---|---|
| `tiny` | 8 GB | Two small chat models plus an embedding model. Conversation works but reasoning is limited. |
| `small` | 16 GB | An 8B chat model, a coding model, a small Google model, embeddings. Capable. |
| `medium` | 32 GB | Two 14B models for chat and code, a 12B Google model, embeddings. A good default for an M-series Pro. |
| `large` | 64 GB | A 32B coding model, a 27B chat model, a 24B Mistral, embeddings. Studio territory. |
| `xl` | 128 GB | Adds a 70B model and a deep reasoning model. Maxed-out Studios. |
| `dreamy` | 192+ GB | The whole pantry. For people with absurdly capable Macs. |

You can pull a different tier any time:

```
nomad models pull large
```

That adds the models in the `large` tier to whatever you already have (no removal).

---

## Upgrading Ollama

Ollama itself updates separately from the Command Center. When a new Ollama release comes out:

```
nomad upgrade ollama
```

That runs `brew upgrade ollama` and reloads the background service. Your downloaded models keep working — Ollama maintains backward compatibility within a major version.

---

## What's NOT how it works

A few things people sometimes ask about:

- **The "Reinstall AI Assistant" button** that appears in upstream N.O.M.A.D. on some pages tries to recreate the AI Assistant container. On the Mac edition there is no container to recreate, so that button is hidden. To restart the AI Assistant, use `nomad reset-ollama` from Terminal.

- **The "Update Available" message** in admin's Settings → Updates page refers to the Command Center itself, not Ollama. To update Ollama, use `nomad upgrade ollama` as above. To update the Command Center, use `nomad upgrade admin` (see [Updating](/docs/mac-updates)).

- **There's no GPU passthrough config to manage.** Ollama uses the GPU automatically on Apple Silicon. If your Mac has a GPU (every M-series chip does), the AI Assistant uses it.
