# install/macos — distribution layer (installer CLI + portable chat + dual-disk state)

The macOS install path for this fork. A single-file bash CLI (`nomad`) that handles install, upgrades, repair, and lifecycle from the Terminal; a portable browser-chat UI that drops onto the user's data drive; a compose variant with split-storage so the data drive can be safely unplugged.

## TL;DR

From a fresh clone or extracted tarball:

```bash
bash install/macos/nomad install
```

Idempotent. Re-run is repair. Everything else (Homebrew, Xcode CLT, Rosetta, OrbStack, native Ollama LaunchAgent, model pulls, secrets, container stack, admin DB seed) is handled inline.

## What's in here

| File | Purpose |
|---|---|
| `nomad` | Single-file bash CLI. Subcommands: `install`, `check`, `up`, `down`, `restart`, `logs`, `models pull <tier>`, `upgrade`, `upgrade-models`, `benchmark`, `downloads`, `zim`, `services`, `system`, `api`, `orbstack-tune`, `reset-ollama`, `fix-kiwix`, `clean`, `reinstall`, `uninstall`. Self-symlinks to `$(brew --prefix)/bin/nomad` at install time. |
| `compose.yaml` | macOS-tuned compose file. Default admin image is `ghcr.io/caweis/project-nomad-macos-arm64:edge` (multi-arch, built from this repo's `admin/` tree). Layered fallback at install time: caweis → proximasan (multi-arch) → upstream amd64 under Rosetta. Split-storage: mysql + redis on `${NOMAD_STATE_ROOT}` (always internal), admin storage on `${NOMAD_DATA_ROOT}` (configurable, can be external drive). |
| `quick-chat.html` | Self-contained portable chat UI. Single file, ~670 lines. Boot overlay polls Ollama on `:11434`, shows copy-pasteable bootstrap command if not running, transitions to streaming chat once available. Drops onto the data drive at install — plug the drive into any other Mac, open the file, get LLM chat with no NOMAD install needed. |
| `quick-chat.sh` | Companion script for `quick-chat.html`. Auto-installs Ollama via Homebrew if missing, sets `OLLAMA_MODELS` to point at the drive's model cache, starts the daemon, opens the HTML. |
| `nomad.1` | mdoc-format manpage. Installed at `$(brew --prefix)/share/man/man1/nomad.1` so `man nomad` works after install. |
| `userscripts/` | Browser userscripts (Tampermonkey / Userscripts / Violentmonkey). `admin-same-tab.user.js` strips `target="_blank"` from admin links so service tiles open in the same tab. See `userscripts/README.md` for install instructions and the upstream issue we're patching around. |
| `scripts/wipe-and-pave.command` | Double-clickable Desktop-droppable script for "I'm testing a new admin image and want zero cached state to mask the result." Runs `nomad uninstall --yes`, removes cached admin Docker images (caweis, proximasan, crosstalk-solutions), clears residual logs. Preserves Homebrew, OrbStack, Ollama binaries, the bundle itself. |
| `LICENSE` | Apache-2.0 — matches the parent repo's license. |

## Storage architecture (unplug-resilient)

```
INTERNAL — always available, hot state
  ~/.config/project-nomad/state/mysql/      MySQL data dir
  ~/.config/project-nomad/state/redis/      Redis data
  ~/.config/project-nomad/.env              secrets (chmod 600, off-iCloud)
  ~/Library/LaunchAgents/...ollama.plist    native Ollama daemon

CONFIGURABLE — typically external, cold content
  ${NOMAD_DATA_ROOT}/storage/               Wikipedia ZIMs, Kolibri, Qdrant, FlatNotes
  ${NOMAD_DATA_ROOT}/ollama-models/         model weights
  ${NOMAD_DATA_ROOT}/quick-chat.html/sh     portable chat UI for any Mac
```

Drive-eject is safe. MySQL and Redis keep running because their data is internal. Admin keeps responding. Content services (Kiwix, Kolibri, etc.) can't spawn until the drive returns. Native Ollama keeps any already-loaded model in RAM via `OLLAMA_KEEP_ALIVE=30m`. To replug: plug the drive back in, then `nomad up`.

Drive renames are safe too. The Ollama LaunchAgent runs through a wrapper script (`~/.config/project-nomad/ollama-launcher.sh`) that resolves the data drive at runtime: tries the configured path from `.env`, falls back to scanning `/Volumes/*` for any drive containing `project-nomad/ollama-models`, and finally falls back to `~/.ollama/models`. Plug into a Mac with the drive renamed (`/Volumes/MyDrive 1` instead of `/Volumes/MyDrive`) — Ollama still finds the models.

`nomad check stack` reports the live mount state — `data drive disconnected` shows up clearly when it's unplugged.

## Cross-Mac drive portability

Every install drops three things onto the data drive at `<drive>/project-nomad/`:

| File | What it does |
|---|---|
| `quick-chat.sh` | LLM-chat-only bootstrap. Auto-installs Ollama via Homebrew if missing, sets `OLLAMA_MODELS` to the drive's cache, starts the daemon, opens `quick-chat.html` in the browser. No Docker, no admin UI — just chat. |
| `install-nomad.command` | Full-stack bootstrap. Double-click from Finder; detects whether NOMAD is already installed on this Mac, and if not, runs the installer from the bundle that lives on the drive. No internet fetch needed for the install code itself. |
| `install-bundle/` | Mirror of the `install/macos/` tree from this repo. The installer reads from here when the user double-clicks `install-nomad.command`. Refreshed on every `nomad install` so the drive always carries the latest installer with it. |

Plug the drive into any other Apple Silicon Mac:

- Want chat only? `bash /Volumes/<drive>/project-nomad/quick-chat.sh`
- Want full stack? Double-click `/Volumes/<drive>/project-nomad/install-nomad.command`

Both work without internet for the part that lives on the drive. Homebrew, OrbStack, and Ollama still need network access for first-time downloads if they're not already installed on the target Mac.

## Tier-based model pulls — RAM-aware

`nomad install` defaults to `--tier auto`, which inspects `sysctl hw.memsize` and picks one of:

| Tier | Min RAM | What gets pulled |
|---|---|---|
| `tiny` | 8 GB | llama3.2:3b, gemma3:1b, nomic-embed-text |
| `small` | 16 GB | llama3.1:8b, qwen2.5-coder:7b, gemma3:4b, nomic-embed-text |
| `medium` | 36 GB | llama3.1:8b, qwen3:14b, qwen2.5-coder:14b, gemma3:12b, nomic-embed-text |
| `large` | 65 GB | llama3.1:8b, qwen3:14b, qwen2.5-coder:32b, gemma3:27b, mistral-small:24b, nomic-embed-text |
| `xl` | 128 GB | llama3.1:8b, qwen3:32b, qwen2.5-coder:32b, llama3.3:70b, deepseek-r1:32b, gemma3:27b, mistral-small:24b, nomic-embed-text, mxbai-embed-large |
| `dreamy` | 192+ GB | + qwen2.5:72b, deepseek-r1:70b, phi4:14b — for maxed-out Studios |

Pull a different tier later: `nomad models pull large`. List installed with per-Mac fits-this-Mac verdict: `nomad models list`.

## OrbStack auto-tune

Default OrbStack VM allocation is too small for NOMAD's full stack on machines with serious RAM. `nomad install` auto-tunes to ~80% of host RAM (proportional formula, scales 8 GB Air → 192 GB Studio). Re-tune later with `nomad orbstack-tune` or `nomad orbstack-tune 64` for explicit GB.

## Workshop — offline STL library

Database-backed catalog of 3D-printable files (.stl, .3mf) that live on `${NOMAD_DATA_ROOT}/storage/stl-library/`. Tile appears in the Command Center alongside Maps; at `/workshop` in the admin UI.

Architecture:

- Files on disk are the source of truth. The admin's `stl_files` table is an index, rebuilt by `StlScannerService.scan()`.
- New files land with `metadata_pending=true`. User fills name + material + print time + difficulty in the UI to flip them to a complete state.
- Thumbnails generated by `stl-thumb` (bundled in the admin image, multi-arch). 256×256 PNGs cached in `storage/stl-library/.thumbnails/`.
- Drive unplugged → grid renders an "unavailable" panel (same shape as Kiwix when its drive is out).
- One-time rights modal on first visit — user acknowledges they're responsible for ensuring they have the right to store each file. Recorded in `kv_store(workshop.rightsAcknowledged)`. No per-file enforcement.

Host-side ops via `nomad stl`:

```
nomad stl path                      Show library root on this host
nomad stl scan                      Rescan disk → index
nomad stl import ~/Downloads/stls medical
                                    Copy *.stl/*.3mf into the library +
                                    auto-rescan. Optional second arg sets
                                    the category subdir.
nomad stl list                      Print admin's catalog as JSON
```

Categories: `medical`, `tools`, `household`, `replacement-parts`, `agriculture`, `firearm-accessories` (where legal), `other`. Materials: PLA, PETG, ABS, TPU, Resin, Nylon. Difficulty: beginner, intermediate, advanced. Tags freeform.

Ported from SysAdminDoc/project-nomad-desktop §50. Their feature catalog has 60+ esoteric add-ons; STL Library is offline-first by nature so it goes in first. Other esoteric ports (cache tracking, watch rotation, knowledge bus factor) come later if useful.

## Apple Silicon hardware identification

Three layers of defense for the leaderboard CPU/GPU surfacing:

1. **`APPLE_CHIP_MODEL` / `APPLE_GPU_MODEL` env-var fallback in admin** — patches in `admin/app/services/system_service.ts` read these vars when `si.cpu()` returns empty/generic chip info inside Docker. (Pattern adapted from proximasan's fork, extended to also override `APPLE_GPU_MODEL`.) compose.yaml passes both vars from .env.
2. **Install-time host probe** captures the chip via `system_profiler SPHardwareDataType` / `SPDisplaysDataType` and writes both vars into `~/.config/project-nomad/.env`.
3. **Auto-patcher LaunchAgent** (`~/.config/project-nomad/benchmark-patcher.sh`) runs every 30s and backfills `cpu_model` / `gpu_model` on benchmark_results rows in case admin's container-side detection misses them. Manual: `nomad benchmark patch-host`.

## Commands cheatsheet

```
nomad install [opts]    Full install. Idempotent — also fixes broken state.
nomad check [section]   Diagnose: system | stack | install (preflight) | all.
nomad up                Start the stack
nomad down              Stop the stack (native Ollama keeps running)
nomad restart [svc]     Restart a service (default: admin)
nomad logs [svc]        Tail logs (default: admin)
nomad models list       List installed + fits-this-Mac verdict
nomad models pull TIER  Pull a tier preset (tiny/small/medium/large/xl/dreamy)
nomad benchmark         Native-Metal vs container-Rosetta tokens/sec on llama3.1:8b
nomad benchmark patch-host    Backfill admin's leaderboard with this Mac's chip
nomad downloads list    Admin's BullMQ queue (ZIM downloads, model pulls)
nomad zim list          Installed ZIM files
nomad zim wikipedia     Wikipedia variant management (state | select)
nomad stl list          Workshop STL library — admin's catalog
nomad stl scan          Rescan ${NOMAD_DATA_ROOT}/storage/stl-library/ → index
nomad stl import DIR    Copy .stl/.3mf from DIR into library + auto-rescan
                        (optional second arg = category; default 'other')
nomad stl path          Print the library root on this host
nomad services list     Admin-spawned content services (Kiwix, Qdrant, Kolibri)
nomad system info       Admin's view of host
nomad api PATH [BODY]   Raw admin API call — generic escape hatch
nomad orbstack-tune     Tune OrbStack VM RAM (auto = 80% of host)
nomad reset-ollama [--internal|--drive]
                        Recover Ollama. Auto-detects a wedged external data
                        drive, falls back to internal models, and auto-pulls a
                        disk-gated, RAM-sized model set. --internal forces
                        internal; --drive restores to the drive (refused if
                        still wedged).
nomad fix-kiwix         Manual trigger of kiwix self-heal pass
                        (the kiwix-self-heal LaunchAgent runs same logic every 60s)
nomad clean [--apply]   Safe disk cleanup. Dry-run by default. Removes /tmp/nomad-*.log,
                        $COMPOSE_BASE.bak, quarantined partial ZIMs, dangling Docker
                        images + builder cache, stopped admin-spawned containers.
                        Never touches running containers, models, or kept data.
nomad upgrade [svc]     Software upgrade router — compose stack, native Ollama,
                        admin-spawned containers. --check for dry-run.
nomad upgrade-models    Re-pull installed models at latest tags
nomad reinstall         Full uninstall + install (one confirm prompt up front)
nomad uninstall         Remove containers, LaunchAgents, secrets, (with confirm) data
```

Other entry points:

```
install/macos/userscripts/admin-same-tab.user.js
                        Browser userscript (Tampermonkey / Userscripts / Violentmonkey)
                        that strips target="_blank" from admin links so service tiles
                        open in the same tab. Workaround for upstream issue #866.
                        See userscripts/README.md for install steps.

install/macos/scripts/wipe-and-pave.command
                        Double-clickable Desktop-droppable. For "I'm testing a new
                        admin image — clean every cached state before reinstall."
                        Uninstalls NOMAD, removes cached admin images (caweis,
                        proximasan, crosstalk), clears /tmp + Library/Logs residue.
                        Preserves Homebrew, OrbStack, Ollama, the bundle itself.
```

Install options:

```
--data-root PATH        Cold content root (default: prompt internal vs external)
--tier TIER             Model preset (auto/tiny/small/medium/large/xl/dreamy)
--models "a b c"        Explicit list, overrides --tier
--no-models             Skip model pulls entirely
--yes / -y              Auto-confirm prompts (for unattended runs)
```

## Capabilities

- Lifecycle CLI (`install`, `up`, `down`, `restart`, `logs`, `check`, `upgrade`, `self-update`, `reinstall`, `uninstall`, …) installed to PATH at `$(brew --prefix)/bin/nomad`.
- Standalone bundle — runs from any directory.
- Split storage: `${NOMAD_STATE_ROOT}` (internal disk, always-available) + `${NOMAD_DATA_ROOT}` (configurable, can be external drive).
- Dual-disk unplug-resilience: MySQL and Redis stay up when the data drive ejects.
- RAM-aware tier presets (tiny → dreamy) auto-detected from `sysctl hw.memsize`.
- OrbStack auto-tune to 80% of host RAM.
- Pre-flight inventory (`nomad check install`) before touching anything.
- Portable `quick-chat.html` + `quick-chat.sh` on the data drive so any other Mac can chat with the cached models without a full install.
- mdoc manpage (`man nomad`) installed at `$(brew --prefix)/share/man/man1/`.
- `nomad fix-kiwix` + LaunchAgent — transparent self-heal for the partial-ZIM crash loop (60s polling, reactive on kiwix's own error log).

## Lineage credit

The Apple Silicon admin patches that make Metal-aware benchmark reporting work come from a fork series, each fork building on the prior:

- **Crosstalk-Solutions/project-nomad** — upstream.
- **NoamanKhalil/project-nomad-MacOs** — foundational Phase 1-3 macOS port work.
- **proximasan/project-nomad-silicon** — originated the `APPLE_CHIP_MODEL` env-var fallback, `isNativeOllama()` / `getNativeOllamaURL()`, multi-arch GHCR images.
- **snfettig/project-nomad-macos-arm64** — native Ollama on Metal.

This repo carries forward-ported versions of the proximasan patches (plus `APPLE_GPU_MODEL` and atomic-rename ZIM downloads), rebuilds the admin image as `ghcr.io/caweis/project-nomad-macos-arm64` for a `linux/amd64,linux/arm64` multi-arch, and adds the installer/lifecycle layer above the admin tree. proximasan's GHCR image remains the first fallback at install time.

## License

Apache-2.0 — matching the parent repo.
