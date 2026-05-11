<div align="center">
<img src="https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/refs/heads/main/admin/public/project_nomad_logo.png" width="200" height="200"/>

# Project N.O.M.A.D. — Mac edition

</div>

A fork of [Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad) targeting macOS on Apple Silicon. NOMAD is an offline-first knowledge server — Wikipedia, regional maps, AI chat, Khan Academy, reference libraries — running on hardware you own.

NOMAD upstream is built for Linux with NVIDIA GPUs. The macOS port came together over the last few months — NoamanKhalil ported the foundation, proximasan added the Apple Silicon admin patches, snfettig wired native Ollama to Metal. This repo is one more step in that line: a multi-arch rebuild of the admin image, install-pipeline fixes for things fresh Macs were hitting, and a `nomad` command that bundles install, upgrades, and lifecycle into one place from the Terminal. Standing on a lot of shoulders.

Useful for people who want their own offline knowledge node: preppers, homeschoolers, off-grid setups, classroom labs, family servers.

## Install

On a fresh Apple Silicon Mac (M1 or later, macOS 14+):

```bash
mkdir -p ~/Developer && cd ~/Developer && \
  curl -fsSL https://github.com/caweis/project-nomad-macos-arm64/archive/refs/heads/feat/macos-distribution-layer.tar.gz | tar xz && \
  bash project-nomad-feat-macos-distribution-layer/install/macos/nomad install
```

The installer asks where to store data (external drive is the usual answer) and which AI models to pull, then handles Homebrew, OrbStack, native Ollama, the container stack, database setup, content downloads, and a help library. Idempotent — re-running fixes anything that broke.

Admin lands at `http://localhost:8080`, or `http://nomad.local:8080` from any device on the same network.

## What's in it

The admin home page has tiles for:

- **AI Assistant** — local Ollama chat, runs on the Mac's Metal GPU.
- **Information Library** — Wikipedia (your choice of size, from 50 MB to 96 GB), plus reference works on medicine, mechanics, cooking, survival, anything else you download.
- **Education Platform** — Kolibri (Khan Academy and other coursework).
- **Maps** — offline regional maps.
- **Workshop** — catalog of 3D-printable files (STL/3MF) you've collected.
- **Notes** — local-only notebook.
- **Data Tools** — CyberChef for encoding / encryption / data conversion.

Reachable from other devices on the same network. The data drive can be unplugged for travel and the management plane keeps running; plug back in to restore content. Plug the drive into any other Apple Silicon Mac and double-click `install-nomad.command` at the drive root to set up NOMAD there from the bundled installer (no internet needed for the install code itself).

## What's different from upstream

- Admin container built for both `linux/amd64` and `linux/arm64`.
- Ollama runs as a Homebrew install rather than a Docker container, so it can use the Metal GPU.
- ZIM downloader writes to a temp file and renames on completion, which prevents a half-downloaded library from crashing Kiwix.
- Migrations and seeders run during install. There's a worker container so download jobs actually progress.
- Updates happen with `nomad upgrade` from the Terminal.

## Updating

Two things to keep current:

```bash
nomad self-update    # refreshes the `nomad` CLI script itself
nomad upgrade        # refreshes container images and Ollama
```

`nomad self-update` resolves the install path automatically — works regardless of where the script lives on your Mac. `nomad install` and `nomad reinstall` self-update before running, so the CLI stays current as a side effect of the install path.

Full reference: [`install/macos/README.md`](./install/macos/README.md).

## Lineage

- [Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad) — upstream
- [NoamanKhalil/project-nomad-MacOs](https://github.com/NoamanKhalil/project-nomad-MacOs) — first macOS port
- [proximasan/project-nomad-silicon](https://github.com/proximasan/project-nomad-silicon) — Apple Silicon admin patches, multi-arch images
- [snfettig/project-nomad-macos-arm64](https://github.com/snfettig/project-nomad-macos-arm64) — native Ollama on Metal, immediate fork-parent

## Status

Active work is on [`feat/macos-distribution-layer`](https://github.com/caweis/project-nomad/tree/feat/macos-distribution-layer). Validated end-to-end on a Mac mini M4 with 32 GB. Weekly upstream-diff reports land in [Issues](https://github.com/caweis/project-nomad/issues?q=label%3Aupstream-tracking).

## Versioning

This fork uses an independent SemVer scheme with a `-macos` pre-release suffix. The label in `package.json` (and the admin About panel) reflects fork releases, **not** upstream's `1.x.x` line.

Our merge-base with upstream is commit [`c668396`](https://github.com/Crosstalk-Solutions/project-nomad/commit/c668396) (October 2025). Upstream changes from `v1.29.1` → `v1.31.1` (and now `v1.32.0-rc`) are forward-ported commit-by-commit when applicable; the fork's version label is bumped on its own cadence rather than tracking upstream's numbers. This makes the fork status explicit instead of implying a feature parity the code may not have.

Apache-2.0.
