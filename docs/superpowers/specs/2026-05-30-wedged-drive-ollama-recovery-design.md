# Wedged-drive Ollama recovery — design

**Date:** 2026-05-30
**Branch:** `feat/macos-distribution-layer`
**Component:** `install/macos/nomad` (the macOS lifecycle CLI) + the generated `ollama-launcher.sh`
**Status:** Approved design — ready for implementation plan

---

## Problem

On NOMAD macOS installs, Ollama's model store usually lives on an external
data drive (`$NOMAD_DATA_ROOT/ollama-models`). When that drive enters a
**mounted-but-wedged** state (APFS hang on a deep-path read), Ollama wedges
indefinitely: every HTTP endpoint (`/api/tags`, `/api/version`, `/`) blocks on
a disk syscall, the goroutine pool stalls, but the process stays alive, the
port stays in `LISTEN`, and `launchctl` reports a healthy agent.

The failure is insidious because the drive *looks* mounted:
- `diskutil info` responds (mount metadata is fine)
- `ls /Volumes/` works (drive appears mounted)
- `ls $DRIVE_MODELS/manifests/registry.ollama.ai/library/` **hangs** (deep read)

**Today `nomad reset-ollama` cannot escape this.** Its sequence
(`cmd_reset_ollama`, `install/macos/nomad:4060`) boots out the agent, kills the
process, re-bootstraps the LaunchAgent — which runs `ollama-launcher.sh`, which
re-resolves `OLLAMA_MODELS` to the same drive path (it passes the `[[ -d ]]`
check because the directory *is* mounted) — and then the wait-for-API loop
(step 6) times out at 30s. Re-running just loops.

The documented manual recovery (MemPalace anti-patterns drawer) is a multi-step
dance: bootout + `pkill -9` + overwrite `ollama-launcher.sh` to force
`~/.ollama/models` + bootstrap + verify + `ollama pull`. It is error-prone and
requires the operator to already know the drive is wedged.

## Goal

Make `nomad reset-ollama` **self-healing** against the wedged-drive failure:
detect the wedge with a bounded probe, fall back to internal models so the
command always returns quickly, auto-pull the tier-appropriate model set (sized
to the machine, disk-gated) so chat works immediately, report what happened and
how to restore, and auto-restore to the drive on a later reset once the drive is
healthy again.

## Non-goals

- Performing the physical drive unplug/replug. Dropping wedged kernel FS state
  requires a physical replug; that is stated to the user, not automated.
- Any host-command-bridge button / `HostCommandName` entry for recovery. That
  is allow-list surface and lands with sub-project ③ (allow-list single-source).
- An interactive tier picker on recovery. Install prompts (`preview_pull_menu`);
  recovery uses the auto-detected tier directly so it stays non-interactive and
  bridge-safe.

## Command surface

`nomad reset-ollama [--internal | --drive]` — extends the existing command, no
new namespace.

| Invocation | Behavior |
|---|---|
| `reset-ollama` (no flag) | **Auto.** Probe the drive's deep models path. **Wedged** → set marker, restart on internal models, report. **Healthy + marker present** → clear marker, restart on drive (auto-restore from a prior recovery), report. **Healthy, no marker** → normal drive restart (today's behavior, unchanged). |
| `reset-ollama --internal` | Force internal regardless of probe (set marker). Explicit escape hatch; non-interactive-safe (future bridge button). |
| `reset-ollama --drive` | Force restore to drive (clear marker). **Refuses** (non-zero exit, no bootstrap) if the probe still shows wedged — never re-bootstrap onto a hung path. |

`--internal` and `--drive` are mutually exclusive (passing both → usage error).

## State mechanism — marker file honored by the launcher

**Marker:** `~/.config/project-nomad/.force-internal-models` (`$SECRETS_DIR/.force-internal-models`).
Empty sentinel file; its *presence* means "force internal models."

**Launcher step-0 (new):** The generated `ollama-launcher.sh`
(`install/macos/nomad` ~line 1438, inside `step_ollama_native`) gains a first
resolution step, *before* the existing `.env`/`/Volumes` drive resolution:

```bash
# 0. Forced-internal override (set by `nomad reset-ollama --internal` or
#    auto-fallback when the data drive is wedged). Honored here so launchd
#    KeepAlive respawns also stay internal until the marker is cleared.
if [[ -f "$SECRETS_DIR/.force-internal-models" ]]; then
  export OLLAMA_MODELS="$HOME/.ollama/models"
  echo "[ollama-launcher] forced-internal marker present — using $OLLAMA_MODELS" >&2
  exec ${ollama_bin} serve
fi
```

Because the check is baked into the **generator**, a future `nomad install`
regenerating the launcher preserves the behavior. Because the launcher itself
honors the marker, a launchd **KeepAlive respawn** also stays internal until the
marker is cleared. This is the property neither the backup-and-overwrite
(orphaned on reinstall) nor the plist-rewrite (same fragility + risk) approaches
have.

## Wedge probe

A bounded read of the drive's deep models path, with **no coreutils
dependency** (cannot assume `gtimeout`/`timeout`; brew is present but the probe
must work regardless):

```bash
# Returns 0 = readable-or-fast-fail (NOT wedged); 1 = timed out (wedged).
_probe_readable() {
  local path="$1" t="${2:-5}"
  ( ls "$path" >/dev/null 2>&1 ) &
  local pid=$!
  ( sleep "$t"; kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  if wait "$pid" 2>/dev/null; then
    kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
    return 0            # returned within the window (success OR fast ENOENT)
  fi
  return 1              # killed by watcher → the read hung → wedged
}
```

**Probe target:** the drive models path resolved the same way the launcher
resolves it, suffixed with a deep subpath: `$DRIVE_MODELS/manifests`. Rationale:
the memory shows top-level `ls` of the drive succeeds while the deep manifests
read hangs — we must probe deep. If the deep path is simply absent (fresh drive,
no models pulled), `ls` fast-fails (ENOENT) → treated as **not wedged**, which is
correct (absence is the launcher's existing fallback case, not a wedge).

**Probe semantics:** only a *timeout* counts as wedged. Drive-not-mounted-at-all
also fast-fails as not-wedged; the launcher's existing `/Volumes` fallback chain
handles plain absence.

## Drive-models resolver (DRY — Maxim 22)

The `.env` → `DRIVE_MODELS` resolution currently exists only inside the
generated launcher (a standalone script run under launchd — it *cannot* source
`nomad`). The probe needs the same resolution. To avoid spreading the
`grep '^NOMAD_DATA_ROOT=' "$ENV_FILE" | cut -d= -f2-` idiom further, add **one**
helper in `nomad`:

```bash
# Resolve the drive-backed models dir the way the launcher does:
#   1. $NOMAD_DATA_ROOT/ollama-models from .env, if it exists
#   2. else scan /Volumes/*/project-nomad/ollama-models
#   3. else empty (caller treats empty as "no drive models → internal")
_resolve_drive_models() { ... }
```

`cmd_reset_ollama` uses `_resolve_drive_models` for the probe side. The
launcher keeps its own self-contained copy (unavoidable — generated, standalone).
This is the single inherent duplication; it is documented at both sites with a
"keep in sync with `_resolve_drive_models`" comment.

## reset-ollama state machine (revised `cmd_reset_ollama`)

The marker decision happens **before** `launchctl bootstrap`, so the launcher
resolves to the correct source on its *first* spawn and the existing
wait-for-API loop (step 6) succeeds in seconds instead of timing out.

```
parse flags → internal_forced | drive_forced | auto   # --internal + --drive ⇒ usage error

# Decide the source BEFORE touching launchd:
if internal_forced:
    set marker
    report "forcing internal models (~/.ollama/models)"

elif drive_forced:
    drive = _resolve_drive_models
    if drive is empty:
        die "--drive refused: no data drive / ollama-models found to restore to.
             Mount the drive (or run `nomad install`), then retry."
    if _probe_readable("$drive/manifests") == wedged:
        die "--drive refused: data drive still wedged at <drive>.
             Physically unplug/replug the drive, then retry."
    clear marker
    report "restoring drive-backed models at <drive>"

else:  # auto
    drive = _resolve_drive_models
    if drive is non-empty and _probe_readable("$drive/manifests") == wedged:
        set marker
        report wedge + "fell back to internal; physical replug required; next reset auto-restores"
    elif drive is non-empty:                 # resolved AND healthy
        if marker present:
            clear marker
            report "drive healthy — restored to drive-backed models"
        # else: nothing to do — normal drive restart (today's behavior)
    else:                                     # drive absent — NOT confirmed back
        # Leave the marker untouched. If it is set we stay internal (correct —
        # the drive isn't back yet); the launcher's own /Volumes fallback handles
        # plain absence. This is the same as today's behavior for internal-only
        # or drive-unplugged installs.
        report "no data drive resolved — launcher will use its fallback chain"

# Existing flow, now safe:
bootout → kill orphans → confirm :11434 free → plist exists?
  → bootstrap (3-attempt retry) → wait-for-API (30s)

# Post-restart: auto-pull models IAW system performance (only when running
# internal — the drive store is normally already populated).
if marker present (running internal):
    count = ollama list | tail -n +2 | wc -l        # daemon already uses internal store
    if count == 0:
        _autopull_tier_models       # disk-gated, best-effort, offline-safe (see below)
```

All existing safety in `cmd_reset_ollama` (bootout-before-kill ordering,
`pkill` escalation to `-9`, `:11434` free check, plist-exists guard, 3-attempt
bootstrap retry) is preserved unchanged.

## Model auto-pull, IAW system performance (`_autopull_tier_models`)

When recovery brings the daemon up on an **empty internal store**, it
auto-pulls the tier-appropriate model set so chat (and RAG) work immediately —
reusing the canonical install machinery, not a forked model list (Maxim 4):

- `auto_tier()` — RAM → tier (`tiny`…`dreamy`). This *is* "iaw system
  performance."
- `resolve_tier_models("auto")` — the exact model list `nomad install` pulls
  for this machine.
- `pull_one_model()` — the existing progress-aware pull (`install/macos/nomad:1799`).

**Runs only after the wait-for-API loop confirms the daemon is responsive**, so
recovery's primary success (a responsive Ollama) never depends on the download.
Pulls target the running daemon on :11434, which stores into `~/.ollama/models`
because the forced-internal marker is active — no `OLLAMA_MODELS` override needed
on the client.

### Disk-space gate (non-negotiable — Maxim 9 / Three Laws)

The boot drive is small *by design* (that's why models live on the external
drive). Tier footprints run `tiny ~3 GB → dreamy ~215 GB`, so pulling a full
high tier into `~/.ollama/models` could fill the system volume. The gate:

```
target = auto_tier()
avail_gb = free space on the volume holding ~/.ollama/models   # df -g "$HOME/.ollama" (or nearest existing parent)
HEADROOM_GB = 10                                               # never consume the last 10 GB

# Downshift to the largest tier whose estimate + headroom fits.
ladder = tiny small medium large xl dreamy   # only ever moves DOWN from target → always RAM-safe
for tier in (target down to tiny):
    if tier_size_gb(tier) + HEADROOM_GB <= avail_gb:
        pull resolve_tier_models(tier); report "<tier> set (downshifted from <target> for disk space)"; done

# Sub-floor: even tiny (~3 GB) doesn't fit → try the smallest useful pair only.
if llama3.2:3b + nomic-embed-text (~2.3 GB) + HEADROOM fits:
    pull "llama3.2:3b nomic-embed-text"; warn "disk tight — pulled minimal chat+embed only"
else:
    skip pull; warn "boot drive critically low (<avail_gb> GB free) — cannot auto-pull";
    print "free space, then:  ollama pull llama3.2:3b"
```

Downshift only ever moves to a *smaller* tier than RAM allows, so it can never
pick models too big for the machine.

### Network / offline behavior

Best-effort. `pull_one_model` returns non-zero per model on network failure;
those are caught and accumulated. If **no** model pulled (offline), recovery
still reports overall success (daemon is up) and prints the manual command to
run once online. A partial set (some pulled, some failed) reports what landed.

### Scope of auto-pull

Applies to the **auto wedge-fallback** and explicit **`--internal`** paths
(both end up running internal). The **`--drive`** restore path does not auto-pull
— the drive store is the populated one we're restoring to.

## Field Desk compatibility (cross-cutting constraint)

The NOMAD Field Desk variant (restored in sub-project ②) is another consumer of
the **same Ollama daemon on :11434**. Recovery restarts Ollama on the same port
and only changes `OLLAMA_MODELS` — it never touches the listen address or daemon
identity. So a running Field Desk keeps reaching :11434 transparently across a
recovery; the now-active model set serves the Crosstalk admin and Field Desk
alike. Nothing in this design adds a dispatcher case or allow-list entry, so it
leaves the ② re-add fully unobstructed. **On-device checklist item:** with Field
Desk running, trigger a recovery and confirm its AI Chat still reaches :11434.

## Error handling

- The probe is always timeout-bounded — the command can never hang on the wedge.
- Marker writes are `mkdir -p "$SECRETS_DIR"`-guarded (same guard the launcher
  generator already uses).
- `--drive` refusal is an explicit non-zero `die` with a remediation message; it
  does **not** bootstrap onto a wedged drive.
- Fully non-interactive (no prompts) — safe under the host-command bridge.
- `--internal` + `--drive` together → usage error before any side effect.

## Testing

No bats/shellcheck harness exists in the repo (CI is image-build only). Plan:

1. **Sourceable pure helpers.** Factor `_probe_readable`, `_resolve_drive_models`,
   marker set/clear/check, and the disk-gate tier selector (the pure part of
   `_autopull_tier_models` — `avail_gb` + `target` in → chosen tier out) into
   functions safe to source without running the dispatcher (guard the dispatch
   tail with the existing bottom-of-file pattern). Add
   `install/macos/scripts/test-reset-ollama.sh`:
   - `_probe_readable` against a **FIFO** (named pipe) to simulate a hang →
     expect wedged within the timeout; against a normal dir → expect not-wedged;
     against a non-existent path → expect not-wedged (fast ENOENT).
   - marker round-trip: set → check present → clear → check absent.
   - `_resolve_drive_models` against a temp `.env` with/without a real dir.
   - **disk-gate selector** (inject `avail_gb` so it's deterministic): target
     `dreamy` + 5 GB free → picks `tiny` (downshift); target `medium` + 100 GB
     → picks `medium` (no downshift); target `tiny` + 4 GB → sub-floor
     chat+embed; 1 GB free → skip-with-warn. Asserts downshift never selects a
     tier above the RAM target.
2. **shellcheck** the changed functions (run locally; document the invocation in
   the test script header).
3. **On-device round-trip checklist** (flagged for Chris — a real wedge can't be
   faked in CI). Uses the documented repro on the Mac mini:
   - Healthy drive → `reset-ollama` → drive-backed, no marker. ✓
   - Simulate/observe wedge → `reset-ollama` → marker set, internal models,
     API responds in seconds; if internal store empty, disk-gated auto-pull of
     the auto-tier set runs (verify it downshifts when boot space is tight). ✓
   - `reset-ollama --drive` while still wedged → refused with message. ✓
   - Physical replug → `reset-ollama` → marker cleared, drive-backed, report
     "restored to drive." ✓
   - Field Desk running throughout → AI Chat reaches :11434 after each step. ✓

## Files touched

- `install/macos/nomad`
  - `cmd_reset_ollama` (~4060): flag parsing + probe/marker state machine +
    post-restart empty-store auto-pull.
  - new helpers `_probe_readable`, `_resolve_drive_models`, marker helpers,
    `_autopull_tier_models` (disk-gated; reuses `auto_tier` /
    `resolve_tier_models` / `tier_size_gb` / `pull_one_model`).
  - launcher generator (~1438): step-0 marker honor.
  - help/usage text for the new flags (header comment block + `reset-ollama`
    line wherever usage is printed).
- `install/macos/scripts/test-reset-ollama.sh` (new).
- `install/macos/README.md` + `install/macos/nomad.1`: document
  `reset-ollama [--internal|--drive]` and the auto-heal behavior.

## Open implementation questions (resolve in writing-plans)

- Exact insertion point for sourceable-helper guard so `test-reset-ollama.sh`
  can source `nomad` without triggering dispatch (the script currently runs
  logic via the bottom `case "$CMD"`; confirm there's a clean `return`-if-sourced
  seam or add one).
- `df` portability for `avail_gb`: confirm `df -g "$HOME/.ollama"` (or the
  nearest existing parent when `~/.ollama` doesn't exist yet) gives GB on the
  target macOS versions; fall back to parsing `df -k` if `-g` is unavailable.
- Whether `_autopull_tier_models` should run pulls in the foreground (user sees
  native progress, matches install) or background under the bridge — leaning
  foreground for parity, since the bridge already tolerates long host commands.
