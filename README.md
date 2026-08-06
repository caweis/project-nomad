<div align="center">
<img src="admin/public/project_nomad_logo.png" width="200" height="200"/>

# Project N.O.M.A.D. — Mac edition

</div>

A fork of [Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad) targeting macOS on Apple Silicon. NOMAD is an offline-first knowledge server — Wikipedia, regional maps, AI chat, Khan Academy, reference libraries — running on hardware you own.

NOMAD upstream is built for Linux with NVIDIA GPUs. The macOS port came together over the last few months — NoamanKhalil ported the foundation, proximasan added the Apple Silicon admin patches, snfettig wired native Ollama to Metal. This repo is one more step in that line: a multi-arch rebuild of the admin image, install-pipeline fixes for things fresh Macs were hitting, and a `nomad` command that bundles install, upgrades, and lifecycle into one place from the Terminal. Standing on a lot of shoulders.

Useful for people who want their own offline knowledge node: preppers, homeschoolers, off-grid setups, classroom labs, family servers.

## Install

On a fresh Apple Silicon Mac (M1 or later, macOS 14+), one command:

```bash
curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/main/install/bootstrap.sh | bash
```

It drops the `nomad` command bundle in `~/Applications/project-nomad`, then runs `nomad install`. The installer asks two things: where to keep your **content** — Wikipedia, AI models, maps (an external drive is the usual answer) — and which AI models to pull for your Mac's RAM. The code stays on the internal disk; the content lives wherever you point it, so the drive can be unplugged for travel and reconnected later. On Apple Silicon running macOS 15 or later the installer also offers a choice of AI engine — oMLX (Apple's MLX runtime) or the native Ollama it uses elsewhere — and you can switch later with `nomad backend`.

Homebrew, Xcode Command Line Tools, Rosetta, OrbStack, native Ollama, the container stack, the database, and the offline help library are all handled for you. It's idempotent — re-running repairs anything that broke.

Admin lands at `http://localhost:8080`, or `http://nomad.local:8080` from any device on the same network. Full command reference: `man nomad` (and per-command pages, e.g. `man nomad-update`).

## What's in it

The admin home page has tiles for:

- **AI Assistant** — local AI chat on the Mac's Metal GPU (Ollama, or oMLX if you chose that backend).
- **Information Library** — Wikipedia (your choice of size, from 50 MB to 96 GB), plus reference works on medicine, mechanics, cooking, survival, anything else you download.
- **Education Platform** — Kolibri (Khan Academy and other coursework).
- **Maps** — offline regional maps.
- **Workshop** — catalog of maker files you've collected: 3D prints (STL/3MF), CAD, PDFs, and reference images, with thumbnails.
- **Drug Reference** — offline FDA drug labels (about 259,000, Rx and OTC), pulled straight from openFDA. Search by drug name, or by situation — burn, fever, diarrhea — and see which OTC drugs treat it. Herbal remedies from NIH's NCCIH fact sheets show up alongside the drugs, cited and clearly marked as complementary.
- **Preparedness** — supply inventory (consumables and gear), a readiness calculator that turns what's on the shelf into days of water, food, and power for your household (pets included), and per-scenario checklists.
- **Notes** — local-only notebook.
- **Data Tools** — CyberChef for encoding / encryption / data conversion.

Reachable from other devices on the same network. The data drive can be unplugged for travel and the management plane keeps running; plug back in to restore content. Plug the drive into any other Apple Silicon Mac and double-click `install-nomad.command` at the drive root to set up NOMAD there from the bundled installer (no internet needed for the install code itself).

## Models

The installer pulls a starter set of AI models sized to your Mac's RAM. To see what's installed and add more later:

```bash
nomad models list                       # installed models, plus the size tiers and the one auto-detected for this Mac
nomad models pull medium                # pull a whole tier: tiny | small | medium | large | xl | dreamy
nomad models pull qwen3:32b gemma3:27b  # pull specific models by name
nomad upgrade-models                    # refresh installed models to their latest tags
```

Tiers scale with RAM, from about 3 GB (`tiny`) to about 215 GB (`dreamy`); `nomad models list` prints each tier's size. Models stream into the AI Assistant as they finish, so earlier ones are usable while larger ones download.

The model names are the same whichever backend you run. On Ollama, `nomad models pull` fetches the GGUF build; on the oMLX backend it fetches the MLX build through the local proxy. Either way the AI Assistant tile and the API on `:11434` see the models the same way, so switching backends doesn't change how you manage them.

## What's different from upstream

- Admin container built for both `linux/amd64` and `linux/arm64`.
- Ollama runs as a Homebrew install rather than a Docker container, so it can use the Metal GPU.
- ZIM downloader writes to a temp file and renames on completion, which prevents a half-downloaded library from crashing Kiwix.
- Migrations and seeders run during install. There's a worker container so download jobs actually progress.
- Updating and lifecycle are one command each from the Terminal (`nomad update`, `nomad upgrade`).
- Optional oMLX (Apple MLX) backend, selectable at install or via `nomad backend`; the admin is unchanged because a local proxy speaks the Ollama API on its behalf.
- Drug Reference and Preparedness are additions in this fork; upstream doesn't have them. Both work fully offline once their data is in (the FDA download is ~1.7 GB and needs internet once; the readiness math and remedy data ship with the app).

## Updating

```bash
nomad update     # fetch the latest bundle and reinstall in place — no data loss
```

`nomad update` finds your install on its own, pulls the latest, and re-runs the installer in place — your content and pulled models are left untouched (it is not a wipe; that's `nomad reinstall`). Related: `nomad upgrade` refreshes the container images and Ollama, and `nomad reset-ollama` recovers the AI service if its data drive hiccups.

Full reference: [`install/macos/README.md`](./install/macos/README.md), or `man nomad`.

## Troubleshooting

`nomad check` (or `nomad check stack`) reports the health of every service; logs live in `~/Library/Logs/nomad-*.log`. A few specific things:

- **`nomad` runs the wrong tool.** If HashiCorp's `nomad` is also on your PATH, `which nomad` may point there. Ours installs to `~/Applications/project-nomad`; run it explicitly as `bash ~/Applications/project-nomad/install/macos/nomad <command>`, or re-run the install one-liner to re-point the `nomad` symlink.

- **`nomad update` or `self-update` returns a 404.** An older install can be pinned to a retired branch. Run `NOMAD_BRANCH=main nomad self-update` once (or just re-run the install one-liner); both land you on `main`, which is the default and self-heals afterward.

- **AI chat returns an error on the oMLX backend.** A chat embeds your query before generating, so all three oMLX-mode services must be up. Check `nomad check stack` — the proxy (`:11434`), oMLX (`:8000`), and the embed-only Ollama (`:11435`) should all be green. If one is down, `nomad reset-ollama` rebuilds the stack. Logs: `~/Library/Logs/nomad-omlx*.err.log`.

- **The System page shows a generic CPU** (e.g. "Apple Silicon (10-core)" instead of your exact chip). The admin can't read the host chip from inside its container, so the installer injects it; `nomad update` re-probes and refreshes that.

- **The benchmark can't find a model to run.** On the oMLX backend, model pulls are restricted to the curated map; if a model the admin asks for isn't mapped, `nomad update` to the latest, then retry.

## Lineage

- [Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad) — upstream
- [NoamanKhalil/project-nomad-MacOs](https://github.com/NoamanKhalil/project-nomad-MacOs) — first macOS port
- [proximasan/project-nomad-silicon](https://github.com/proximasan/project-nomad-silicon) — Apple Silicon admin patches, multi-arch images
- [snfettig/project-nomad-macos-arm64](https://github.com/snfettig/project-nomad-macos-arm64) — native Ollama on Metal, immediate fork-parent

A build of this fork shows up briefly in Crosstalk's video ["This Free Offline Server Just Got a Massive Upgrade"](https://www.youtube.com/watch?v=ilLCN_SRKLc) — not by name, but by build.

## Status

`main` is the canonical line — installs and `nomad update` track it. Validated end-to-end on a Mac mini M4 with 32 GB. Weekly upstream-diff reports land in [Issues](https://github.com/caweis/project-nomad/issues?q=label%3Aupstream-tracking).

## Versioning

This fork uses an independent SemVer scheme with a `-macos` pre-release suffix. The label in `package.json` (and the admin About panel) reflects fork releases, **not** upstream's `1.x.x` line.

Our merge-base with upstream is commit [`8bb8b41`](https://github.com/Crosstalk-Solutions/project-nomad/commit/8bb8b41) (March 2026). Upstream changes since then (through `v1.32.1`) are forward-ported commit-by-commit when applicable; the fork's version label is bumped on its own cadence rather than tracking upstream's numbers. This makes the fork status explicit instead of implying a feature parity the code may not have.

Apache-2.0.
