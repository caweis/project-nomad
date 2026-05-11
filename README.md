<div align="center">
<img src="https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/refs/heads/main/admin/public/project_nomad_logo.png" width="200" height="200"/>

# Project N.O.M.A.D. — Mac edition

</div>

A pocket-sized civilization that lives in your closet.

[Project N.O.M.A.D.](https://github.com/Crosstalk-Solutions/project-nomad) is Crosstalk-Solutions' offline-first knowledge server — Wikipedia, regional maps, AI chat, Khan Academy courses, reference libraries on everything from medicine to mechanics to bread-baking, all running on a Mac in your house with no internet required after install. This fork makes it work properly on Apple Silicon.

NOMAD upstream is built for Linux with NVIDIA GPUs. Getting it onto Macs has been years of work by people who did the hard parts — NoamanKhalil ported the foundation, proximasan added the Apple Silicon admin patches, snfettig wired native Ollama to Metal. This repo is one more step in that line: a multi-arch rebuild of the admin image (so it runs on `arm64` alongside `amd64`), some install-pipeline fixes for things fresh Macs were hitting, and a `nomad` command that bundles install, upgrades, and lifecycle into one place from the Terminal. Standing on a lot of shoulders.

If you're a prepper, a homeschooler, an off-grid landowner, a parent who doesn't want everything their kid sees to require a Cloudflare cert, or a sysadmin who likes solving problems that don't have Stack Overflow answers — this is for you.

## Try it

Paste this into Terminal on a fresh Apple Silicon Mac:

```bash
mkdir -p ~/Developer && cd ~/Developer && \
  curl -fsSL https://github.com/caweis/project-nomad-macos-arm64/archive/refs/heads/feat/macos-distribution-layer.tar.gz | tar xz && \
  bash project-nomad-feat-macos-distribution-layer/install/macos/nomad install
```

The installer asks you two things — where to store data (an external drive, usually) and which AI models to pull (it shows you the list before downloading) — and handles everything else. Homebrew, OrbStack, native Ollama as a LaunchAgent, the container stack, database migrations, content seeding, model downloads, kiwix self-heal, an end-user help library, the works. Idempotent: re-run any time. That's also the repair path.

When it's done, open `http://localhost:8080` on the Mac. Or `http://nomad.local:8080` from any phone, tablet, or laptop on the same WiFi.

## What you get

The Command Center home page is tiles you click:

- **AI Assistant.** Local chat that runs on your Mac's Metal GPU. No internet, no API keys, your conversations never leave the machine. Bring your own models — Llama, Qwen, Gemma, DeepSeek — the install picks a tier that fits your RAM.
- **Information Library.** Wikipedia in whatever size you want, from a 50 MB "top articles" dump to the full 96 GB English download. Plus medical references, military field manuals, repair guides, prepping content, cooking, Khan Academy mirrors, whatever you've curated. All searchable, all offline.
- **Education Platform.** Kolibri — Khan Academy courses with progress tracking, K-12 curriculum content.
- **Maps.** Offline regional maps. You download once, then they work forever, no Google trying to remember where you've been.
- **Workshop.** A catalog of 3D-printable files you've collected, with thumbnails, categories, print times. Drop STLs into a folder, the scanner picks them up.
- **Notes.** Local-only notebook with markdown.
- **Data Tools.** Swiss-army-knife for encoding, encryption, hashing, format conversion (CyberChef).

Everything is browseable from any device on your network. Unplug your data drive when you travel and the management plane keeps running; plug back in and the content comes back. The drive can move between Macs — a single `quick-chat.sh` script lives at its root so any other Mac can boot the AI chat directly off the drive without installing anything.

## What's different from upstream

The admin container is built for both `linux/amd64` and `linux/arm64` so it runs natively on Apple Silicon instead of being emulated by Rosetta. Ollama runs as a Homebrew install talking to the Metal GPU directly — Apple Silicon's actual reason for being — rather than as a Docker container with no GPU access. The ZIM downloader writes to a temp file and renames atomically on completion, so a half-downloaded Wikipedia doesn't crash Kiwix on the next start. Migrations and seeders run automatically. There's a worker container so downloads actually progress. The local Bonjour name gets set to `nomad` so the Mac is reachable at `nomad.local` from every other device. Updates happen with `nomad upgrade` from Terminal, not a flaky button in the admin that tries to rewrite compose files it doesn't recognize.

For the full list of differences, install steps, storage architecture, and CLI reference: [`install/macos/README.md`](./install/macos/README.md).

## Lineage

I didn't build NOMAD. The credit chain matters:

- [**Crosstalk-Solutions/project-nomad**](https://github.com/Crosstalk-Solutions/project-nomad) — the original. Linux-first, big-hearted, the reason any of this exists.
- [**NoamanKhalil/project-nomad-MacOs**](https://github.com/NoamanKhalil/project-nomad-MacOs) — first serious macOS port. Phase 1-3 foundational work.
- [**proximasan/project-nomad-silicon**](https://github.com/proximasan/project-nomad-silicon) — admin patches for Apple Silicon (`isNativeOllama`, `APPLE_CHIP_MODEL` env-var fallback), multi-arch GHCR images. Their image is still the install-time fallback if mine is unreachable.
- [**snfettig/project-nomad-macos-arm64**](https://github.com/snfettig/project-nomad-macos-arm64) — native-Ollama-with-Metal commit, the immediate fork-parent of this repo.

What this fork adds on top: the installer/lifecycle CLI, atomic-rename ZIM downloader, auto-migrations + seeders + worker container, multi-arch image rebuild from current admin source, Workshop, install-time UX (model picker, hostname rename, Desktop-droppable tools, browser userscripts), and a weekly workflow that diffs upstream so we don't drift.

## Status & contributing

Active dev on [`feat/macos-distribution-layer`](https://github.com/caweis/project-nomad/tree/feat/macos-distribution-layer) — that's the branch that gets the new image builds. End-to-end install is validated on a Mac mini M4 with 32 GB. Weekly upstream-diff reports land in [Issues](https://github.com/caweis/project-nomad/issues?q=label%3Aupstream-tracking) every Monday morning.

PRs welcome, especially if you're running this on something other than a Mac mini and find rough edges. Open an issue first if it's a bigger change.

Apache-2.0 throughout.
