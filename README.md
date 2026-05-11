<div align="center">
<img src="https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/refs/heads/main/admin/public/project_nomad_logo.png" width="200" height="200"/>

# Project N.O.M.A.D.
### macOS / Apple Silicon distribution

**Offline-first knowledge server, tuned for Macs.**

[![Upstream](https://img.shields.io/badge/Upstream-Crosstalk--Solutions%2Fproject--nomad-blue)](https://github.com/Crosstalk-Solutions/project-nomad)
[![License](https://img.shields.io/badge/License-Apache--2.0-green)](./LICENSE)

</div>

---

This is **caweis's macOS distribution** of [Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad) — an offline-first knowledge and education server with AI assistant, Wikipedia, maps, reference libraries, and more. The fork specifically targets **macOS on Apple Silicon** with first-class **native Ollama + Metal GPU** support; all installer and admin-side patches needed to make that work are bundled in.

The main development branch is **[`feat/macos-distribution-layer`](https://github.com/caweis/project-nomad/tree/feat/macos-distribution-layer)** — that's where all the active work lives until each PR train lands here on `main`.

## What's different from upstream

| Area | Upstream Crosstalk | This fork |
|---|---|---|
| Ollama | Docker container | **Native** via Homebrew on `:11434` → Apple Metal GPU directly, no Rosetta |
| Install | `bash install/install_nomad_macos.sh` from this repo | `nomad install` CLI with subcommands (lifecycle, models, upgrades, diagnostics) |
| Admin image | `ghcr.io/crosstalk-solutions/project-nomad:vX.Y.Z` (linux/amd64) | `ghcr.io/caweis/project-nomad-macos-arm64:edge` (linux/amd64 + linux/arm64, multi-arch) |
| ZIM downloader | Direct file write — partial download crashes Kiwix | Atomic rename (`.tmp` → final on completion); plus a 60s self-heal LaunchAgent that quarantines partials |
| Bootstrap | Manual migrations + seed steps documented in upstream's wiki | Auto-runs migrations + seeds the services catalog during install |
| Job worker | Missing from compose; downloads silently queue forever | Dedicated `nomad_admin_worker` container running `node ace queue:work --all` |
| Apple chip detection | `Apple Silicon (16-core)` generic placeholder | Real chip name from `system_profiler` (`Apple M2 Pro`, etc.) — passed via env vars |
| Storage layout | Single volume | **Split:** mysql + redis on internal SSD (always-mounted); content + models on external drive (unplug-safe) |
| Update path | Admin's broken Docker-image self-rewrite | `nomad upgrade compose / ollama / all` from Terminal |
| Workshop | — | New: offline catalog of 3D-printable STLs with thumbnails (Workshop §50 port) |

## Install

Single command on a fresh Mac (Apple Silicon, macOS 14+):

```bash
mkdir -p ~/Developer && cd ~/Developer && \
  curl -fsSL https://github.com/caweis/project-nomad-macos-arm64/archive/refs/heads/feat/macos-distribution-layer.tar.gz | tar xz && \
  bash project-nomad-feat-macos-distribution-layer/install/macos/nomad install
```

That handles:

1. Homebrew + Xcode CLT + Rosetta (if missing)
2. OrbStack install + auto-tune to 80% of host RAM
3. Native Ollama install via Homebrew + LaunchAgent on `:11434`
4. Compose stack pull (caweis multi-arch image — falls back to proximasan or upstream amd64 under Rosetta if our image is unreachable)
5. Admin database migrations + services catalog seed
6. Wire admin → native Ollama (retries on transient 500s)
7. Background LaunchAgents: kiwix self-heal (partial-ZIM quarantine + auto-reload), benchmark patcher (real Apple chip backfill)
8. Help ZIM build, dropped into the Kiwix library
9. RAM-aware model pull tier (auto-detected from `sysctl hw.memsize`; interactive picker shows what you'll get)

Idempotent. Re-run is repair.

After install, the admin is at **http://localhost:8080** (or `http://nomad.local:8080` from any device on the same WiFi, if you accepted the Bonjour rename).

## CLI cheatsheet

```
nomad install [opts]    Full install (idempotent — repair on re-run)
nomad check [section]   Diagnose: system | stack | install (preflight) | all
nomad up / down         Start / stop the stack (native Ollama keeps running)
nomad restart [svc]     Restart a service (default: admin)
nomad logs [svc]        Tail logs (default: admin)
nomad models            List installed + per-Mac fits-this-Mac verdict
nomad models pull TIER  Pull a tier preset (tiny/small/medium/large/xl/dreamy)
nomad benchmark         Native-Metal vs container-Rosetta tokens/sec
nomad downloads list    Admin's BullMQ job queue
nomad zim list          Installed ZIM files
nomad stl import DIR    Bulk-import STLs into the Workshop library
nomad orbstack-tune     Tune OrbStack VM RAM (auto = 80% of host)
nomad upgrade [svc]     Upgrade compose / ollama / kiwix / all
nomad reset-ollama      Recover from stuck LaunchAgent state
nomad fix-kiwix         Manual trigger of the kiwix self-heal pass
nomad clean [--apply]   Safe disk cleanup (dry-run by default)
nomad uninstall         Remove containers, agents, secrets, (with confirm) data
nomad reinstall         Nuclear: wipe everything + reinstall in one shot
```

`man nomad` after install for the full reference.

## Documentation

- **[`install/macos/README.md`](./install/macos/README.md)** — full distribution-layer documentation: storage architecture, drive-portability, tier presets, OrbStack tuning, Apple Silicon hardware identification, Workshop details
- **[`install/macos/userscripts/README.md`](./install/macos/userscripts/README.md)** — browser userscripts (Tampermonkey / Userscripts / Violentmonkey) for patching admin UI quirks
- **[`install/macos/help/`](./install/macos/help/)** — end-user help content, built into a Kiwix-served ZIM at install time

## Lineage

This work stands on these forks in sequence:

- **[Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad)** — original Linux-first project
- **[NoamanKhalil/project-nomad-MacOs](https://github.com/NoamanKhalil/project-nomad-MacOs)** — foundational Phase 1-3 macOS port work
- **[proximasan/project-nomad-silicon](https://github.com/proximasan/project-nomad-silicon)** — `APPLE_CHIP_MODEL` env-var fallback, `isNativeOllama()`/`getNativeOllamaURL()` admin patches, multi-arch GHCR images. Their image is our install-time fallback when our own is unreachable.
- **[snfettig/project-nomad-macos-arm64](https://github.com/snfettig/project-nomad-macos-arm64)** — original native-Ollama+Metal commit, the immediate fork-parent of this repo
- **caweis/project-nomad-macos-arm64** — this repo. Adds the installer/lifecycle layer, atomic-rename downloader port, admin migrations + services seed + worker container in compose, Workshop §50 port, multi-arch CI build, install-time UX improvements (model picker, hostname rename, Desktop tool drop, browser userscripts)

## Status

The macOS distribution layer is shipped on the **[`feat/macos-distribution-layer`](https://github.com/caweis/project-nomad/tree/feat/macos-distribution-layer)** branch and tracked as PR #2 against [snfettig/project-nomad-macos-arm64](https://github.com/snfettig/project-nomad-macos-arm64). Active development continues there. Weekly upstream-tracking reports land in [Issues](https://github.com/caweis/project-nomad/issues?q=label%3Aupstream-tracking) every Monday.

## License

Apache-2.0 — matching the upstream project.
