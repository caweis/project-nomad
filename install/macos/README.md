# install/macos — distribution layer (installer CLI + portable chat + dual-disk state)

Optional alternative to the existing `install/install_nomad_macos.sh` flow. This subdirectory is a **distribution layer**: a single-file bash CLI (`nomad`) that wraps the macOS install path with subcommand-based lifecycle UX, plus a portable browser-chat UI that drops onto the user's data drive, plus a compose variant with split-storage so the data drive can be safely unplugged.

Doesn't touch any of snfettig's existing scripts or the admin tree. Three decoupled pieces — could be merged together or split into separate PRs if that fits the review better.

## TL;DR

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

## Cross-Mac drive portability — `quick-chat.sh`

Every install drops a self-contained portable script onto the data drive at `<drive>/project-nomad/quick-chat.sh`. Plug the drive into ANY Mac (one without NOMAD installed, or even without Homebrew) and run:

```bash
bash /Volumes/<drive>/project-nomad/quick-chat.sh
```

Native Ollama starts, all the drive's cached models are immediately available, browser chat UI opens. Auto-installs Ollama via Homebrew if missing, sets `OLLAMA_MODELS` to point at the drive, starts the daemon. No NOMAD install required, no Docker, no admin UI — just the LLM chat layer.

For the full NOMAD experience on the second Mac, run the regular install path.

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
nomad reset-ollama      Recover from stuck LaunchAgent state
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

## Differences from `install/install_nomad_macos.sh`

This subdirectory's `nomad install` is an alternative entry point — not a replacement. The existing `install_nomad_macos.sh` script remains untouched. Differences:

| `install_nomad_macos.sh` | `install/macos/nomad install` |
|---|---|
| Linear script, single run | Lifecycle CLI (`up/down/restart/logs/check/...`) installed to PATH |
| Clones repo, runs from repo dir | Standalone bundle — runs from any directory |
| Single data root | Split: `${NOMAD_STATE_ROOT}` (internal) + `${NOMAD_DATA_ROOT}` (configurable) |
| | Dual-disk unplug-resilience (mysql/redis stay up when data drive ejects) |
| | RAM-aware tier presets (tiny → dreamy) auto-detected |
| | OrbStack auto-tune to 80% of host RAM |
| | Pre-flight inventory (`nomad check install`) before touching anything |
| | Portable `quick-chat.html` + `quick-chat.sh` on the data drive |
| | mdoc manpage (`man nomad`) installed at `$(brew --prefix)/share/man/man1/` |
| | `nomad fix-kiwix` + LaunchAgent — transparent self-heal for kiwix's partial-ZIM crash loop (60s polling, reactive based on kiwix's own error log) |

## Lineage credit

The Apple Silicon admin patches that make Metal-aware benchmark reporting work are from this repo and the related fork series:

- **snfettig/project-nomad-macos-arm64** — this repo. Original native-Ollama+Metal commit, current macOS focal point.
- **proximasan/project-nomad-silicon** — originated the `APPLE_CHIP_MODEL` env-var fallback, `isNativeOllama()` / `getNativeOllamaURL()`, multi-arch GHCR images. This repo's `admin/` carries forward-ported versions of those patches (plus `APPLE_GPU_MODEL` and atomic-rename ZIM downloads) and rebuilds the image as `ghcr.io/caweis/project-nomad-macos-arm64` so the macOS distribution stays evergreen. proximasan's GHCR image remains the first fallback at install time.
- **NoamanKhalil/project-nomad-MacOs** — foundational Phase 1-3 macOS port work.
- **Crosstalk-Solutions/project-nomad** — upstream.

This subdirectory stands on those shoulders for the admin layer; the contribution here is the installer/lifecycle layer above it.

## License

Apache-2.0 — matching the parent repo.
