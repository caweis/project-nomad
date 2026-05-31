# oMLX Selectable AI Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a NOMAD install choose its AI runtime — native Metal **Ollama** (today) or **oMLX** (Apple-MLX server) — with the backend auto-recommended from the hardware, the admin unchanged, and full parity (chat, RAG, Easy-Setup model pull) on either.

**Architecture:** The admin stays Ollama-API-locked on `:11434`. `NOMAD_AI_BACKEND` in `~/.config/project-nomad/.env` picks who owns `:11434`: native Ollama (today's behavior) or a vendored **Ollama→OpenAI proxy** that forwards to oMLX on `:8000`. Under oMLX, embeddings are *routed* by the proxy to a tiny embed-only native Ollama on `:11435` (bit-identical `nomic-embed-text` vectors → Qdrant index stays valid, zero reindex). The model name map (Ollama tag → mlx-community HF repo) is the proxy's built-in `MODEL_MAPPING_FILE` — a single JSON source of truth reused by both the wizard pull and `nomad models pull`.

**Tech Stack:** bash (the `install/macos/nomad` CLI), Python 3.10+ / FastAPI / uvicorn / httpx (the vendored proxy, [`eyalrot/ollama_openai`](https://github.com/eyalrot/ollama_openai) MIT), macOS LaunchAgents, [`jundot/omlx`](https://github.com/jundot/omlx) (Apache-2.0). Tests: the existing bash `NOMAD_SOURCE_FOR_TEST=1 source` harness + `pytest` for the proxy.

---

## Spec ↔ reality reconciliation (read first)

The approved spec (`docs/superpowers/specs/2026-05-31-omlx-backend-option-design.md`) was written before the upstream proxy was inspected. Three spec items are now simpler; this plan supersedes the spec on these points (the spec has been annotated to match):

1. **`/api/show` + `/api/version`**: already implemented upstream (`src/routers/models.py:231` and `:254`, synthesized from `/v1/models`). **No work.**
2. **`/api/pull`**: already exists but returns **501 Not Implemented** (`src/routers/models.py:141`). We **replace** it with an oMLX-downloader bridge — not "add from scratch."
3. **Name map + "parallel MLX tier table"**: the proxy has a built-in `MODEL_MAPPING_FILE` (flat `{"ollama-tag":"hf-repo"}` JSON, loaded by `src/translators/base.py`). We ship one JSON map as the **single** mapping source and **reuse the existing `TIER_*` model lists** rather than maintaining a second MLX tier table. A drift test asserts every tier model has a map entry.
4. **Download port**: oMLX README confirms a **single `:8000`** for inference *and* `/api/hf/download`. We target `:8000` and keep a cheap `:8080` fallback probe (the download path wasn't 100% documented), satisfying the spec's "probe both" decision without a second known port.

---

## File structure

**The `nomad` CLI** (`install/macos/nomad`, one big bash file — follow its existing conventions, do not restructure):
- New pure helpers near the existing detection/tier helpers (lines ~330–355, ~476–534): `_nomad_os_major`, `_nomad_arch`, `backend_eligible`, `recommend_backend`, `_load_backend`.
- New install steps near the LaunchAgent generators (lines ~1398–1607): `step_omlx_native`, `step_omlx_proxy`, `step_ollama_embed`.
- New install UX near `prompt_for_models` (lines ~2017–2081): `prompt_for_backend`.
- New command `cmd_backend` near `cmd_reset_ollama` (lines ~4362–4495).
- Backend-awareness edits inside `cmd_check`, `cmd_reset_ollama`, `cmd_models`, `cmd_install`, the flag parser, the dispatch `case`, and the usage block.

**The vendored proxy** (new dir `install/macos/omlx-proxy/`):
- `vendor/` — `eyalrot/ollama_openai` at a pinned commit (keep its `LICENSE`).
- `vendor/src/routers/nomad_pull.py` — our oMLX `/api/pull` bridge (NEW file in the vendored tree).
- `vendor/src/routers/nomad_embed.py` — our `/api/embeddings` → embed-Ollama router (NEW file).
- `vendor/src/main.py` — 4-line edit to register the two routers ahead of upstream's `/api` ones.
- `config/model_map.json` — Ollama tag → mlx-community repo (single mapping source).
- `PINNED_VERSION.md` — upstream commit SHA + what we changed + why.
- `tests/test_nomad_pull.py`, `tests/test_nomad_embed.py` — pytest with mocked httpx.

**Docs:** `install/macos/man/nomad-backend.1` (new), `install/macos/man/nomad.1` (overview update), `README.md`, the in-script usage block.

**Tests (bash):** `install/macos/scripts/test-omlx-backend.sh`, `install/macos/scripts/test-omlx-model-map.sh`.

---

## Conventions every task follows

- **Source-for-test seam:** bash tests run `NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"` to load functions without dispatching, then re-define `ok/bad/check` (nomad's own `ok()` shadows them). Mirror `test-reset-ollama.sh` exactly.
- **`.env` access:** read with `grep '^KEY=' "$ENV_FILE" | cut -d= -f2-`; write/upsert with the existing `_env_upsert KEY VALUE` (nomad line ~2206).
- **Commit cadence:** one commit per task (Maxim 11). Commit messages end with the `Co-Authored-By: Claude Opus 4.8` trailer.
- **On-device callouts:** steps that can only be verified on a macOS 15 Apple-Silicon Mac are marked **🔌 VERIFY ON DEVICE**. Write the code/commands fully; the executing agent confirms behavior on hardware before the ship-gate.

---

# PART A — the `nomad` CLI

### Task A1: OS/arch detection test seams

**Files:**
- Modify: `install/macos/nomad` (add helpers after `auto_tier()`, ~line 340)
- Test: `install/macos/scripts/test-omlx-backend.sh` (create)

- [ ] **Step 1: Write the failing test**

Create `install/macos/scripts/test-omlx-backend.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
PASS=0 FAIL=0
ok()    { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()   { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
load() {
  TMP="$(mktemp -d -t nomad-omlx-test.XXXXXX)"
  export SECRETS_DIR="$TMP"
  NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
  ok()    { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
  bad()   { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
  check() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
}

echo "== os/arch detection seams =="
load
check "os major from NOMAD_TEST_OS=15.5" "$(NOMAD_TEST_OS=15.5 _nomad_os_major)" "15"
check "os major from NOMAD_TEST_OS=14"   "$(NOMAD_TEST_OS=14   _nomad_os_major)" "14"
check "arch from NOMAD_TEST_ARCH"        "$(NOMAD_TEST_ARCH=arm64 _nomad_arch)"  "arm64"
check "arch x86 from NOMAD_TEST_ARCH"    "$(NOMAD_TEST_ARCH=x86_64 _nomad_arch)" "x86_64"

echo
echo "RESULTS: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: FAIL — `_nomad_os_major: command not found` (function undefined).

- [ ] **Step 3: Add the helpers**

In `install/macos/nomad`, immediately after the `auto_tier()` function (~line 340), add:

```bash
# OS/arch detection with injectable test seams (NOMAD_TEST_OS / NOMAD_TEST_ARCH).
# _nomad_os_major echoes the macOS major version as an integer (e.g. 15).
_nomad_os_major() {
  local ver="${NOMAD_TEST_OS:-$(sw_vers -productVersion 2>/dev/null)}"
  echo "${ver%%.*}"
}
# _nomad_arch echoes the CPU arch (arm64 | x86_64).
_nomad_arch() {
  echo "${NOMAD_TEST_ARCH:-$(uname -m)}"
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: PASS — 4 ok, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-omlx-backend.sh
git commit -m "feat(nomad): OS/arch detection seams for backend gating

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A2: `backend_eligible()` + `recommend_backend()`

**Files:**
- Modify: `install/macos/nomad` (after the Task A1 helpers)
- Test: `install/macos/scripts/test-omlx-backend.sh`

- [ ] **Step 1: Add failing tests**

Append to `test-omlx-backend.sh` before the `RESULTS` line:

```bash
echo "== backend eligibility (Apple Silicon + macOS 15+) =="
load
NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=15.5 backend_eligible && r=yes || r=no; check "arm64+15 eligible" "$r" "yes"
NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=14.7 backend_eligible && r=yes || r=no; check "arm64+14 ineligible" "$r" "no"
NOMAD_TEST_ARCH=x86_64 NOMAD_TEST_OS=15.5 backend_eligible && r=yes || r=no; check "intel+15 ineligible" "$r" "no"

echo "== recommended backend =="
load
check "arm64+15 → omlx"   "$(NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=15.5 recommend_backend)" "omlx"
check "arm64+14 → ollama" "$(NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=14.7 recommend_backend)" "ollama"
check "intel+15 → ollama" "$(NOMAD_TEST_ARCH=x86_64 NOMAD_TEST_OS=15.5 recommend_backend)" "ollama"
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: FAIL — `backend_eligible: command not found`.

- [ ] **Step 3: Add the helpers**

After the Task A1 helpers in `install/macos/nomad`:

```bash
# oMLX needs Apple Silicon + macOS 15 (Sequoia). Returns 0 if eligible.
backend_eligible() {
  local arch major
  arch="$(_nomad_arch)"; major="$(_nomad_os_major)"
  [[ "$arch" == "arm64" && -n "$major" && "$major" -ge 15 ]]
}
# Hardware-recommended default backend: oMLX when eligible, else Ollama.
recommend_backend() {
  if backend_eligible; then echo omlx; else echo ollama; fi
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: PASS — 10 ok, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-omlx-backend.sh
git commit -m "feat(nomad): backend_eligible + recommend_backend (oMLX when eligible)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A3: `NOMAD_AI_BACKEND` .env plumbing + `_load_backend()`

**Files:**
- Modify: `install/macos/nomad` (helper near A2; `.env` writer in `step_secrets` ~line 1795)
- Test: `install/macos/scripts/test-omlx-backend.sh`

- [ ] **Step 1: Add failing tests**

Append before `RESULTS`:

```bash
echo "== backend persisted in .env, with fallback =="
load
ENV_FILE="$SECRETS_DIR/.env"
: > "$ENV_FILE"
_load_backend; check "missing key → ollama fallback" "$BACKEND" "ollama"
echo "NOMAD_AI_BACKEND=omlx" >> "$ENV_FILE"
_load_backend; check "reads omlx from .env" "$BACKEND" "omlx"
echo "NOMAD_AI_BACKEND=bogus" > "$ENV_FILE"
_load_backend; check "invalid value → ollama fallback" "$BACKEND" "ollama"
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: FAIL — `_load_backend: command not found`.

- [ ] **Step 3: Add the reader**

After the A2 helpers:

```bash
# Resolve the active backend into the global BACKEND. Reads NOMAD_AI_BACKEND from
# the .env; anything other than a known backend falls back to ollama (covers old
# .env files and typos). ENV_FILE is defined globally near SECRETS_DIR.
_load_backend() {
  local v=""
  [[ -f "$ENV_FILE" ]] && v="$(grep '^NOMAD_AI_BACKEND=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
  case "$v" in
    ollama|omlx) BACKEND="$v" ;;
    *)           BACKEND="ollama" ;;
  esac
}
```

- [ ] **Step 4: Persist it at install time**

In `step_secrets`, inside the `cat > "$ENV_FILE" <<EOF ... EOF` heredoc (~line 1795, alongside `NOMAD_BUNDLE_DIR`), add a line:

```bash
NOMAD_AI_BACKEND=${BACKEND:-ollama}
```

- [ ] **Step 5: Run it, verify it passes**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: PASS (13 ok).

- [ ] **Step 6: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-omlx-backend.sh
git commit -m "feat(nomad): persist + load NOMAD_AI_BACKEND (.env, ollama fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A4: `--backend` flag parsing + precedence

**Files:**
- Modify: `install/macos/nomad` (flag parser ~line 5108; resolution helper)
- Test: `install/macos/scripts/test-omlx-backend.sh`

`nomad install --backend omlx|ollama` overrides the recommendation; with no flag, the recommendation is used. A `resolve_backend_choice()` helper centralizes precedence: explicit flag > recommendation.

- [ ] **Step 1: Add failing tests**

Append before `RESULTS`:

```bash
echo "== backend choice precedence =="
load
check "no flag, eligible → recommend omlx" \
  "$(BACKEND_ARG='' NOMAD_TEST_ARCH=arm64 NOMAD_TEST_OS=15.5 resolve_backend_choice)" "omlx"
check "flag ollama wins over recommend" \
  "$(BACKEND_ARG=ollama NOMAD_TEST_ARCH=arm64 NOMAD_TEST_OS=15.5 resolve_backend_choice)" "ollama"
check "no flag, ineligible → ollama" \
  "$(BACKEND_ARG='' NOMAD_TEST_ARCH=x86_64 NOMAD_TEST_OS=15.5 resolve_backend_choice)" "ollama"
```

- [ ] **Step 2: Run it, verify it fails**

Expected: FAIL — `resolve_backend_choice: command not found`.

- [ ] **Step 3: Add the resolver**

After `_load_backend`:

```bash
# Precedence: explicit --backend flag (BACKEND_ARG) > hardware recommendation.
# Does NOT enforce eligibility here (the install gate does that, so an explicit
# --backend omlx on an ineligible Mac can produce a clear hard-stop message).
resolve_backend_choice() {
  if [[ -n "${BACKEND_ARG:-}" ]]; then echo "$BACKEND_ARG"; else recommend_backend; fi
}
```

- [ ] **Step 4: Parse the flag**

In the flag-parsing `while`/`case` (~line 5108), add a case alongside `--tier`:

```bash
    --backend) BACKEND_ARG="$2"; shift 2 ;;
```

And initialize `BACKEND_ARG=""` with the other globals (near `TIER`, `MODELS`).

- [ ] **Step 5: Run it, verify it passes**

Expected: PASS (16 ok).

- [ ] **Step 6: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-omlx-backend.sh
git commit -m "feat(nomad): --backend flag + precedence (flag > recommendation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A5: backend picker UX (`prompt_for_backend`)

**Files:**
- Modify: `install/macos/nomad` (after `prompt_for_models`, ~line 2081)
- Test: manual (interactive prompt) — logic covered by A4's resolver test

This mirrors the model-tier picker UX: show what was detected, recommend, accept-or-override. It sets the global `BACKEND`.

- [ ] **Step 1: Add the function**

After `warn_if_tier_above_auto()` (~line 2104):

```bash
# Interactive AI-backend picker — mirrors prompt_for_models. Sets BACKEND.
# Non-interactive (BACKEND_ARG set) skips the prompt. Ineligible Macs are told
# plainly that only Ollama is available (no prompt).
prompt_for_backend() {
  local rec; rec="$(resolve_backend_choice)"
  local arch major; arch="$(_nomad_arch)"; major="$(_nomad_os_major)"

  # Explicit flag: honor it, but hard-stop an impossible request.
  if [[ -n "${BACKEND_ARG:-}" ]]; then
    if [[ "$BACKEND_ARG" == "omlx" ]] && ! backend_eligible; then
      die "oMLX requires Apple Silicon + macOS 15+, this Mac is $arch / macOS ${major}. Re-run with --backend ollama."
    fi
    BACKEND="$BACKEND_ARG"
    log "AI backend (from --backend): $BACKEND"
    return
  fi

  # Ineligible hardware: Ollama only, no prompt.
  if ! backend_eligible; then
    BACKEND="ollama"
    log "AI backend: Ollama (oMLX needs Apple Silicon + macOS 15+; this Mac is $arch / macOS ${major})"
    return
  fi

  section "AI backend selection"
  echo "  Detected: $(_nomad_arch) on macOS $(sw_vers -productVersion 2>/dev/null) → Recommended backend: ${rec}"
  echo
  echo "    oMLX   — Apple-MLX server: continuous batching + KV cache, faster on long RAG context"
  echo "    Ollama — native Metal, the mature default"
  echo
  read -r -p "  Backend [${rec}] (type 'omlx' or 'ollama'): " choice
  choice="$(echo "$choice" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$choice" in
    "")        BACKEND="$rec" ;;
    omlx)      BACKEND="omlx" ;;
    ollama)    BACKEND="ollama" ;;
    *)         warn "didn't understand '$choice' — using recommended '$rec'"; BACKEND="$rec" ;;
  esac
  log "AI backend: $BACKEND"
}
```

- [ ] **Step 2: Sanity-check sourcing**

Run: `bash -n install/macos/nomad` (syntax check) and `bash install/macos/scripts/test-omlx-backend.sh` (still green — no regressions).
Expected: no syntax errors; tests pass.

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "feat(nomad): interactive backend picker (detect → recommend → override)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A6: oMLX serving LaunchAgent (`step_omlx_native`)

**Files:**
- Modify: `install/macos/nomad` (label vars near line ~286; new step near `step_ollama_native`)

🔌 **VERIFY ON DEVICE** — the `brew` formula and `omlx serve` flags are confirmed from oMLX docs but the bootstrap must be exercised on hardware.

- [ ] **Step 1: Add the label vars**

Near the other LaunchAgent label declarations (~line 286, after `HOST_BRIDGE_*`):

```bash
OMLX_LABEL="com.projectnomad.omlx"
OMLX_PLIST="$HOME/Library/LaunchAgents/${OMLX_LABEL}.plist"
PROXY_LABEL="com.projectnomad.ollama-proxy"
PROXY_PLIST="$HOME/Library/LaunchAgents/${PROXY_LABEL}.plist"
EMBED_LABEL="com.projectnomad.ollama-embed"
EMBED_PLIST="$HOME/Library/LaunchAgents/${EMBED_LABEL}.plist"
```

- [ ] **Step 2: Add `step_omlx_native`**

After `step_ollama_native` (~line 1607). Install oMLX via brew, point it at `mlx-models` on the data drive, run it loopback-bound on `:8000`, RAM-tuned concurrency:

```bash
step_omlx_native() {
  section "Native oMLX (Apple-MLX) on :8000"
  local data_root; data_root="$(grep '^NOMAD_DATA_ROOT=' "$ENV_FILE" | cut -d= -f2-)"
  local mlx_dir="$data_root/mlx-models"
  local cache_dir="$data_root/mlx-kv-cache"
  mkdir -p "$mlx_dir" "$cache_dir" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

  # Install oMLX (idempotent). 🔌 VERIFY ON DEVICE: confirm formula name post-tap.
  if ! command -v omlx >/dev/null 2>&1; then
    brew tap jundot/omlx https://github.com/jundot/omlx 2>/dev/null || true
    brew install omlx || die "brew install omlx failed — see https://github.com/jundot/omlx"
  fi
  local omlx_bin; omlx_bin="$(command -v omlx)"

  # Concurrency from RAM (oMLX default is 8); keep modest on small Macs.
  local ram_gb; ram_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  local max_conc=8; [[ $ram_gb -lt 24 ]] && max_conc=4; [[ $ram_gb -lt 16 ]] && max_conc=2

  cat > "$OMLX_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>                 <string>${OMLX_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${omlx_bin}</string>
    <string>serve</string>
    <string>--model-dir</string>          <string>${mlx_dir}</string>
    <string>--paged-ssd-cache-dir</string> <string>${cache_dir}</string>
    <string>--max-concurrent-requests</string> <string>${max_conc}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key> <string>127.0.0.1</string>
    <key>PORT</key> <string>8000</string>
  </dict>
  <key>RunAtLoad</key> <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key> <false/></dict>
  <key>ThrottleInterval</key> <integer>10</integer>
  <key>ExitTimeout</key>      <integer>30</integer>
  <key>StandardOutPath</key>  <string>${HOME}/Library/Logs/nomad-omlx.out.log</string>
  <key>StandardErrorPath</key> <string>${HOME}/Library/Logs/nomad-omlx.err.log</string>
</dict>
</plist>
EOF

  launchctl bootout "$LA_TARGET/$OMLX_LABEL" 2>/dev/null || true
  local last_err=""
  for attempt in 1 2 3; do
    if launchctl bootstrap "$LA_TARGET" "$OMLX_PLIST" 2>/tmp/nomad-bootstrap.log; then
      last_err=""; ok "oMLX LaunchAgent bootstrapped on :8000"; break
    fi
    last_err="$(cat /tmp/nomad-bootstrap.log)"
    launchctl bootout "$LA_TARGET/$OMLX_LABEL" 2>/dev/null || true
    sleep $((attempt * 2))
  done
  [[ -n "$last_err" ]] && die "oMLX bootstrap failed after 3 attempts: $last_err"
}
```

- [ ] **Step 3: Syntax check + commit**

Run: `bash -n install/macos/nomad`
Expected: no errors.

```bash
git add install/macos/nomad
git commit -m "feat(nomad): step_omlx_native — oMLX serving LaunchAgent on :8000

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A7: proxy + embed-only-Ollama LaunchAgents (`step_omlx_proxy`, `step_ollama_embed`)

**Files:**
- Modify: `install/macos/nomad` (new steps after `step_omlx_native`)

🔌 **VERIFY ON DEVICE.** Depends on Part B (the vendored proxy) existing at `$NOMAD_BUNDLE_DIR/install/macos/omlx-proxy`.

- [ ] **Step 1: Add `step_ollama_embed`**

A second native Ollama, bound to `127.0.0.1:11435`, embed-only — reuses the existing `ollama` binary and the `ollama-models` dir (so `nomic-embed-text` is shared with the Ollama backend). After `step_omlx_native`:

```bash
step_ollama_embed() {
  section "Embed-only Ollama on :11435 (hybrid embeddings for oMLX)"
  local ollama_bin; ollama_bin="$(command -v ollama)" || die "ollama not found — install step must run first"
  local data_root; data_root="$(grep '^NOMAD_DATA_ROOT=' "$ENV_FILE" | cut -d= -f2-)"
  cat > "$EMBED_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key> <string>${EMBED_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${ollama_bin}</string><string>serve</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_HOST</key>   <string>127.0.0.1:11435</string>
    <key>OLLAMA_MODELS</key> <string>${data_root}/ollama-models</string>
    <key>OLLAMA_KEEP_ALIVE</key> <string>24h</string>
  </dict>
  <key>RunAtLoad</key> <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key> <false/></dict>
  <key>ThrottleInterval</key> <integer>10</integer>
  <key>StandardOutPath</key>  <string>${HOME}/Library/Logs/nomad-ollama-embed.out.log</string>
  <key>StandardErrorPath</key> <string>${HOME}/Library/Logs/nomad-ollama-embed.err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "$LA_TARGET/$EMBED_LABEL" 2>/dev/null || true
  launchctl bootstrap "$LA_TARGET" "$EMBED_PLIST" 2>/dev/null || die "embed-Ollama bootstrap failed"
  ok "embed-only Ollama on :11435"
  # Ensure the embedding model exists on this instance (shared models dir, so it
  # may already be present from the chat side — pull is then a fast no-op).
  OLLAMA_HOST=127.0.0.1:11435 "$ollama_bin" pull nomic-embed-text >/dev/null 2>&1 || \
    warn "could not pre-pull nomic-embed-text on embed Ollama — RAG will pull on first use"
}
```

- [ ] **Step 2: Add `step_omlx_proxy`**

Sets up the Python venv for the vendored proxy and a LaunchAgent that runs uvicorn on `127.0.0.1:11434`, pointing at oMLX `:8000` and the embed Ollama `:11435`, with the model map:

```bash
step_omlx_proxy() {
  section "Ollama-compat proxy on :11434 → oMLX :8000"
  local bundle; bundle="$(grep '^NOMAD_BUNDLE_DIR=' "$ENV_FILE" | cut -d= -f2-)"
  local proxy_dir="$bundle/install/macos/omlx-proxy"
  [[ -d "$proxy_dir/vendor" ]] || die "proxy not vendored at $proxy_dir/vendor (Part B not installed)"

  # Isolated venv next to the secrets dir (not on the data drive).
  local venv="$SECRETS_DIR/omlx-proxy-venv"
  if [[ ! -x "$venv/bin/uvicorn" ]]; then
    /usr/bin/python3 -m venv "$venv" || die "python3 venv creation failed"
    "$venv/bin/pip" install --quiet -r "$proxy_dir/vendor/requirements.txt" || die "proxy deps install failed"
  fi

  cat > "$PROXY_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key> <string>${PROXY_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${venv}/bin/uvicorn</string>
    <string>src.main:app</string>
    <string>--host</string> <string>127.0.0.1</string>
    <string>--port</string> <string>11434</string>
  </array>
  <key>WorkingDirectory</key> <string>${proxy_dir}/vendor</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENAI_API_BASE_URL</key> <string>http://127.0.0.1:8000/v1</string>
    <key>OPENAI_API_KEY</key>      <string>not-needed-local</string>
    <key>MODEL_MAPPING_FILE</key>  <string>${proxy_dir}/config/model_map.json</string>
    <key>NOMAD_OMLX_BASE</key>     <string>http://127.0.0.1:8000</string>
    <key>NOMAD_OMLX_BASE_FALLBACK</key> <string>http://127.0.0.1:8080</string>
    <key>NOMAD_EMBED_URL</key>     <string>http://127.0.0.1:11435</string>
    <key>PYTHONPATH</key>          <string>${proxy_dir}/vendor</string>
  </dict>
  <key>RunAtLoad</key> <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key> <false/></dict>
  <key>ThrottleInterval</key> <integer>10</integer>
  <key>StandardOutPath</key>  <string>${HOME}/Library/Logs/nomad-omlx-proxy.out.log</string>
  <key>StandardErrorPath</key> <string>${HOME}/Library/Logs/nomad-omlx-proxy.err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "$LA_TARGET/$PROXY_LABEL" 2>/dev/null || true
  launchctl bootstrap "$LA_TARGET" "$PROXY_PLIST" 2>/dev/null || die "proxy bootstrap failed"
  ok "proxy bootstrapped on :11434"
}
```

- [ ] **Step 3: Syntax check + commit**

Run: `bash -n install/macos/nomad`

```bash
git add install/macos/nomad
git commit -m "feat(nomad): step_omlx_proxy + step_ollama_embed LaunchAgents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A8: wire backend selection into `cmd_install`

**Files:**
- Modify: `install/macos/nomad` (`cmd_install`, ~lines 3140–3178)

- [ ] **Step 1: Call the picker early**

In `cmd_install`, right after `prompt_for_models` (~line 3149), add:

```bash
  prompt_for_backend        # sets BACKEND (ollama|omlx); writes to .env via step_secrets
```

(Picker must run before `step_secrets` so `${BACKEND}` is set when the `.env` is written in Task A3 Step 4.)

- [ ] **Step 2: Branch the runtime install step**

Replace the single `step_ollama_native` call (~line 3160) with:

```bash
  if [[ "$BACKEND" == "omlx" ]]; then
    step_omlx_native
    step_ollama_embed       # embed-only Ollama on :11435 (chat-Ollama agent stays unloaded)
    step_omlx_proxy         # proxy owns :11434
  else
    step_ollama_native      # today's behavior
  fi
```

- [ ] **Step 3: Manual trace (dry read)**

Read `cmd_install` top-to-bottom and confirm: `prompt_for_models` → `prompt_for_backend` → … → `step_secrets` (writes `NOMAD_AI_BACKEND`) → backend branch. Confirm `step_secrets` runs *after* `prompt_for_backend` (it does — secrets is ~line 3164, picker ~3149).

- [ ] **Step 4: Syntax check + commit**

Run: `bash -n install/macos/nomad`

```bash
git add install/macos/nomad
git commit -m "feat(nomad): wire backend selection into install flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A9: backend-aware `cmd_check`

**Files:**
- Modify: `install/macos/nomad` (`check_stack` ~line 596, `cmd_check` ~875)

- [ ] **Step 1: Load backend in `cmd_check`**

At the top of `cmd_check` (~line 875), add `_load_backend` so `$BACKEND` is set.

- [ ] **Step 2: Branch the AI probe**

Replace the native-Ollama probe in `check_stack` (~line 596) with:

```bash
  _load_backend
  if [[ "$BACKEND" == "omlx" ]]; then
    if curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "oMLX proxy responding on :11434"
    else
      flag "🔴" "oMLX proxy not responding on :11434" "Check ~/Library/Logs/nomad-omlx-proxy.err.log; run 'nomad reset-ollama'"
    fi
    if curl -fsS --max-time 3 http://127.0.0.1:8000/v1/models >/dev/null 2>&1; then
      ok "oMLX serving on :8000"
    else
      flag "🔴" "oMLX not serving on :8000" "Check ~/Library/Logs/nomad-omlx.err.log"
    fi
    if curl -fsS --max-time 3 http://127.0.0.1:11435/api/tags >/dev/null 2>&1; then
      ok "embed-only Ollama on :11435"
    else
      flag "🟡" "embed Ollama not responding on :11435" "RAG embeddings unavailable; check nomad-ollama-embed.err.log"
    fi
  else
    if curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "native Ollama responding on :11434"
    else
      flag "🔴" "Native Ollama not responding" "Check ~/Library/Logs/nomad-ollama.err.log"
    fi
  fi
```

- [ ] **Step 3: Syntax check + commit**

Run: `bash -n install/macos/nomad`

```bash
git add install/macos/nomad
git commit -m "feat(nomad): backend-aware health checks (proxy/oMLX/embed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A10: backend-aware `cmd_reset_ollama`

**Files:**
- Modify: `install/macos/nomad` (`cmd_reset_ollama`, ~lines 4362–4495)

In oMLX mode, "reset" means bounce the proxy + oMLX + embed agents (keeping the wedged-drive recovery applied to `mlx-models`). The command name stays `reset-ollama` (documented, muscle-memory) but acts on the active backend.

- [ ] **Step 1: Branch at the top of `cmd_reset_ollama`**

After arg parsing (~line 4375), add:

```bash
  _load_backend
  if [[ "$BACKEND" == "omlx" ]]; then _reset_omlx_stack "$mode"; return $?; fi
  # else: existing native-Ollama reset continues unchanged below.
```

- [ ] **Step 2: Add `_reset_omlx_stack`**

Immediately before `cmd_reset_ollama`:

```bash
# oMLX-mode reset: bounce proxy + oMLX + embed agents, reusing the wedged-drive
# probe (now over mlx-models). Mirrors the native reset's bootout→bootstrap→wait.
_reset_omlx_stack() {
  local mode="${1:-auto}"
  section "Resetting oMLX stack (proxy :11434, oMLX :8000, embed :11435)"
  local data_root; data_root="$(grep '^NOMAD_DATA_ROOT=' "$ENV_FILE" | cut -d= -f2-)"
  local mlx_dir="$data_root/mlx-models"
  if [[ -n "$mlx_dir" ]] && _probe_wedged "$mlx_dir" 5; then
    warn "mlx-models path appears wedged ($mlx_dir) — restart the data drive, then re-run"
  fi
  local label
  for label in "$PROXY_LABEL" "$OMLX_LABEL" "$EMBED_LABEL"; do
    launchctl bootout "$LA_TARGET/$label" 2>/dev/null || true
  done
  pkill -f "omlx serve" 2>/dev/null || true
  sleep 1
  step_omlx_native
  step_ollama_embed
  step_omlx_proxy
  local d=$(( $(date +%s) + 30 ))
  while [[ $(date +%s) -lt $d ]]; do
    curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && { ok "oMLX stack back up"; return 0; }
    sleep 1
  done
  flag "🔴" "oMLX stack did not come up within 30s" "Check the three nomad-omlx*.err.log files"
  return 1
}
```

- [ ] **Step 3: Syntax check + commit**

Run: `bash -n install/macos/nomad`

```bash
git add install/macos/nomad
git commit -m "feat(nomad): backend-aware reset-ollama (oMLX stack recovery)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A11: backend-aware `cmd_models`

**Files:**
- Modify: `install/macos/nomad` (`cmd_models`, ~lines 3299–3378)

Both backends talk to `:11434` (native Ollama, or the proxy), and both accept Ollama-tag `/api/pull` and `/api/tags`. So `cmd_models` largely works **as-is** through `:11434` — the proxy translates pull→oMLX-download and tags←/v1/models. The only change: messaging + the "fit" verdict (MLX 4-bit sizes differ) and a backend label.

- [ ] **Step 1: Add a backend banner**

At the top of `cmd_models` (~line 3299), add:

```bash
  _load_backend
  [[ "$BACKEND" == "omlx" ]] && log "AI backend: oMLX (models pulled as MLX via the proxy on :11434)"
```

- [ ] **Step 2: Confirm pull path is backend-agnostic**

Read the `cmd_models pull` branch (~3337). Confirm it pulls by POSTing to `:11434` (or shelling `ollama pull`). **If it shells `ollama pull` directly**, change the omlx branch to use the HTTP API so the proxy handles it:

```bash
  if [[ "$BACKEND" == "omlx" ]]; then
    local m
    for m in $to_pull; do
      log "pulling (MLX) $m via proxy…"
      curl -fsS -X POST http://127.0.0.1:11434/api/pull \
        -H 'Content-Type: application/json' -d "{\"name\":\"$m\"}" \
        --no-buffer || warn "pull failed for $m"
    done
    return 0
  fi
```

(If it already uses the HTTP API for pulls, this branch is unnecessary — leave the existing code and only keep the Step 1 banner.)

- [ ] **Step 3: Syntax check + commit**

Run: `bash -n install/macos/nomad`

```bash
git add install/macos/nomad
git commit -m "feat(nomad): backend-aware models (MLX pull via proxy in omlx mode)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A12: `nomad backend` command (show + switch)

**Files:**
- Modify: `install/macos/nomad` (new `cmd_backend` near `cmd_reset_ollama`; dispatch ~line 5175; flag init)
- Test: `install/macos/scripts/test-omlx-backend.sh`

- [ ] **Step 1: Add failing test (show)**

Append before `RESULTS`:

```bash
echo "== nomad backend show =="
load
ENV_FILE="$SECRETS_DIR/.env"; echo "NOMAD_AI_BACKEND=omlx" > "$ENV_FILE"
check "show reads .env" "$(cmd_backend show 2>/dev/null | tr -d '\n' | grep -oE 'omlx|ollama' | head -1)" "omlx"
```

- [ ] **Step 2: Run, verify it fails**

Expected: FAIL — `cmd_backend: command not found`.

- [ ] **Step 3: Add `cmd_backend`**

Before `cmd_reset_ollama`:

```bash
# nomad backend [show|ollama|omlx]
#   show          → print the active backend
#   ollama|omlx   → switch: rewrite NOMAD_AI_BACKEND, load target agents, unload the other
cmd_backend() {
  local sub="${1:-show}"
  _load_backend
  case "$sub" in
    show|"")
      echo "Active AI backend: $BACKEND"
      return 0 ;;
    ollama|omlx)
      local target="$sub"
      if [[ "$target" == "omlx" ]] && ! backend_eligible; then
        die "oMLX requires Apple Silicon + macOS 15+ — cannot switch on this Mac."
      fi
      if [[ "$target" == "$BACKEND" ]]; then log "already on '$target'"; return 0; fi
      _env_upsert NOMAD_AI_BACKEND "$target"
      if [[ "$target" == "omlx" ]]; then
        launchctl bootout "$LA_TARGET/$LA_LABEL" 2>/dev/null || true   # unload chat-Ollama :11434
        step_omlx_native; step_ollama_embed; step_omlx_proxy
      else
        for label in "$PROXY_LABEL" "$OMLX_LABEL" "$EMBED_LABEL"; do
          launchctl bootout "$LA_TARGET/$label" 2>/dev/null || true
        done
        step_ollama_native
      fi
      BACKEND="$target"
      ok "switched backend → $target (admin still talks to :11434; models on disk are preserved)"
      log "run 'nomad check stack' to confirm health, 'nomad models pull auto' to ensure models"
      ;;
    *) die "usage: nomad backend [show|ollama|omlx]" ;;
  esac
}
```

- [ ] **Step 4: Wire dispatch**

In the main `case "$CMD" in` (~line 5175, alongside `reset-ollama`):

```bash
  backend)         cmd_backend "${EXTRA_ARGS[@]}" ;;
```

- [ ] **Step 5: Run, verify it passes**

Run: `bash install/macos/scripts/test-omlx-backend.sh`
Expected: PASS (all green incl. the new show test).

- [ ] **Step 6: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-omlx-backend.sh
git commit -m "feat(nomad): nomad backend show|ollama|omlx (switch existing install)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A13: usage/help text + uninstall coverage

**Files:**
- Modify: `install/macos/nomad` (usage block lines 2–61; `cmd_uninstall`/`cmd_clean` LaunchAgent teardown)

- [ ] **Step 1: Document in the usage block**

After the `bash nomad check …` line (~line 8), add:

```bash
#   bash nomad backend [show|ollama|omlx]    # show or switch the AI backend
```

And extend the install line to mention the flag:

```bash
#   bash nomad install [--data-root PATH] [--tier auto|tiny|...] [--backend ollama|omlx]
```

- [ ] **Step 2: Tear down the new agents on uninstall**

In `cmd_uninstall` (and `cmd_clean` if it boots out agents), add the three labels to the bootout loop so an oMLX install uninstalls cleanly:

```bash
  for label in "$OMLX_LABEL" "$PROXY_LABEL" "$EMBED_LABEL"; do
    launchctl bootout "$LA_TARGET/$label" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/${label}.plist"
  done
```

- [ ] **Step 3: Syntax check + commit**

Run: `bash -n install/macos/nomad && bash install/macos/scripts/test-omlx-backend.sh`

```bash
git add install/macos/nomad
git commit -m "docs(nomad): usage for 'backend' + uninstall teardown of oMLX agents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PART B — the vendored Ollama→oMLX proxy

### Task B1: vendor `eyalrot/ollama_openai` at a pinned commit

**Files:**
- Create: `install/macos/omlx-proxy/vendor/**` (the upstream tree)
- Create: `install/macos/omlx-proxy/PINNED_VERSION.md`

- [ ] **Step 1: Resolve the pin**

```bash
git ls-remote https://github.com/eyalrot/ollama_openai master
```
Record the SHA (call it `<SHA>`).

- [ ] **Step 2: Vendor the source**

```bash
cd /Users/chrisweis/Developer/project-nomad-macos-arm64
mkdir -p install/macos/omlx-proxy
git clone --depth 1 https://github.com/eyalrot/ollama_openai /tmp/ollama_openai
( cd /tmp/ollama_openai && git fetch --depth 1 origin <SHA> && git checkout <SHA> )
rm -rf /tmp/ollama_openai/.git
mkdir -p install/macos/omlx-proxy/vendor
cp -R /tmp/ollama_openai/src install/macos/omlx-proxy/vendor/src
cp /tmp/ollama_openai/requirements.txt install/macos/omlx-proxy/vendor/requirements.txt
cp /tmp/ollama_openai/LICENSE install/macos/omlx-proxy/vendor/LICENSE
```

- [ ] **Step 3: Record the pin + intent**

Create `install/macos/omlx-proxy/PINNED_VERSION.md`:

```markdown
# Vendored proxy: eyalrot/ollama_openai

- **Upstream:** https://github.com/eyalrot/ollama_openai (MIT)
- **Pinned commit:** <SHA> (master, fetched 2026-05-31)
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
```

- [ ] **Step 4: Commit**

```bash
git add install/macos/omlx-proxy
git commit -m "vendor(omlx-proxy): eyalrot/ollama_openai @ <SHA> (MIT)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B2: the model map (single source) + drift test

**Files:**
- Create: `install/macos/omlx-proxy/config/model_map.json`
- Test: `install/macos/scripts/test-omlx-model-map.sh` (create)

The map's keys are exactly the Ollama tags used in the `TIER_*` lists; values are mlx-community HF repos. 🔌 **VERIFY ON DEVICE** the exact repo names resolve on HuggingFace.

- [ ] **Step 1: Read the actual tier model names**

```bash
grep -nE '^TIER_(TINY|SMALL|MEDIUM|LARGE|XL|DREAMY)=' install/macos/nomad
```
Collect the full set of `name:tag` tokens across all tiers + `nomic-embed-text`.

- [ ] **Step 2: Author `config/model_map.json`**

One entry per tier model. Example (fill in every token from Step 1):

```json
{
  "_comment": "Ollama tag -> mlx-community HF repo. Single source of truth for omlx-mode pulls (wizard + nomad models). Embedding model maps to itself (served by embed-only Ollama on :11435, never oMLX).",
  "llama3.2:1b":  "mlx-community/Llama-3.2-1B-Instruct-4bit",
  "llama3.2:3b":  "mlx-community/Llama-3.2-3B-Instruct-4bit",
  "llama3.1:8b":  "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit",
  "qwen2.5:7b":   "mlx-community/Qwen2.5-7B-Instruct-4bit",
  "qwen2.5:14b":  "mlx-community/Qwen2.5-14B-Instruct-4bit",
  "qwen2.5:32b":  "mlx-community/Qwen2.5-32B-Instruct-4bit",
  "gemma2:9b":    "mlx-community/gemma-2-9b-it-4bit",
  "mixtral:8x7b": "mlx-community/Mixtral-8x7B-Instruct-v0.1-4bit",
  "nomic-embed-text": "nomic-embed-text"
}
```

- [ ] **Step 3: Write the drift test**

Create `install/macos/scripts/test-omlx-model-map.sh` (mirrors `test-host-command-allowlist.sh`):

```bash
#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NOMAD="$ROOT/install/macos/nomad"
MAP="$ROOT/install/macos/omlx-proxy/config/model_map.json"
[[ -f "$NOMAD" ]] || { echo "missing $NOMAD"; exit 1; }
[[ -f "$MAP" ]]   || { echo "missing $MAP"; exit 1; }

# Every model token across all TIER_* defs must have a key in model_map.json.
tier_models="$(grep -E '^TIER_(TINY|SMALL|MEDIUM|LARGE|XL|DREAMY)=' "$NOMAD" \
  | sed -E 's/^[^=]+="//; s/"$//' | tr ' ' '\n' | sort -u | grep -v '^$')"
missing=0
while IFS= read -r m; do
  if ! grep -q "\"$m\"" "$MAP"; then echo "FAIL no map entry for tier model: $m"; missing=$((missing+1)); fi
done <<< "$tier_models"

# model_map.json must be valid JSON.
python3 -c "import json,sys; json.load(open('$MAP'))" || { echo "FAIL model_map.json is not valid JSON"; exit 1; }

if [[ $missing -eq 0 ]]; then echo "ok  every tier model has an mlx map entry; JSON valid"; else echo "FAIL $missing tier model(s) unmapped"; fi
[[ $missing -eq 0 ]]
```

- [ ] **Step 4: Run it, fix gaps**

Run: `bash install/macos/scripts/test-omlx-model-map.sh`
Expected: PASS. If any tier model is unmapped, add it to `model_map.json` and re-run.

- [ ] **Step 5: Commit**

```bash
git add install/macos/omlx-proxy/config/model_map.json install/macos/scripts/test-omlx-model-map.sh
git commit -m "feat(omlx-proxy): model_map.json + tier-coverage drift test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B3: replace `/api/pull` with the oMLX downloader bridge

**Files:**
- Create: `install/macos/omlx-proxy/vendor/src/routers/nomad_pull.py`
- Modify: `install/macos/omlx-proxy/vendor/src/main.py` (register ahead of `models.router` at `/api`)
- Test: `install/macos/omlx-proxy/tests/test_nomad_pull.py` (create)

The new `/api/pull` maps the Ollama tag via the same `MODEL_MAPPING_FILE`, probes `:8000`→`:8080` for `/api/hf/download`, POSTs the download, then polls `/v1/models` until the repo appears, emitting Ollama-style NDJSON throughout. Embedding-model pulls are forwarded to the embed Ollama (where the model already lives), so they return success immediately.

- [ ] **Step 1: Write the failing test**

Create `install/macos/omlx-proxy/tests/test_nomad_pull.py`:

```python
import json, os, sys
import httpx
import pytest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_OMLX_BASE"] = "http://omlx:8000"
os.environ["NOMAD_OMLX_BASE_FALLBACK"] = "http://omlx:8080"
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"

from src.routers import nomad_pull  # noqa: E402


@pytest.mark.asyncio
async def test_chat_pull_emits_success_ndjson(monkeypatch):
    """A chat model: download is fired, /v1/models then shows it, NDJSON ends success."""
    posted = {}

    async def fake_post(url, json=None, **kw):
        posted["url"] = url; posted["json"] = json
        return httpx.Response(200, json={"status": "started"})

    seen = {"n": 0}
    async def fake_get(url, **kw):
        seen["n"] += 1
        models = [] if seen["n"] < 2 else [{"id": "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit"}]
        return httpx.Response(200, json={"data": models})

    monkeypatch.setattr(nomad_pull, "_resolve_mlx_repo", lambda name: "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit")
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: False)
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "post", lambda self, url, **k: fake_post(url, **k))
    monkeypatch.setattr(nomad_pull.httpx.AsyncClient, "get", lambda self, url, **k: fake_get(url, **k))
    monkeypatch.setattr(nomad_pull, "_POLL_INTERVAL", 0)

    lines = [json.loads(l) async for l in nomad_pull._pull_stream("llama3.1:8b")]
    assert posted["json"]["model_id"] == "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit"
    assert "/api/hf/download" in posted["url"]
    assert lines[-1]["status"] == "success"


@pytest.mark.asyncio
async def test_embedding_pull_is_noop_success(monkeypatch):
    monkeypatch.setattr(nomad_pull, "_is_embedding", lambda name: True)
    lines = [json.loads(l) async for l in nomad_pull._pull_stream("nomic-embed-text")]
    assert lines[-1]["status"] == "success"
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd install/macos/omlx-proxy
python3 -m venv /tmp/proxy-test-venv && /tmp/proxy-test-venv/bin/pip install -q -r vendor/requirements.txt pytest pytest-asyncio
/tmp/proxy-test-venv/bin/python -m pytest tests/test_nomad_pull.py -q
```
Expected: FAIL — `ModuleNotFoundError: src.routers.nomad_pull`.

- [ ] **Step 3: Implement the bridge**

Create `install/macos/omlx-proxy/vendor/src/routers/nomad_pull.py`:

```python
"""oMLX-aware /api/pull bridge.

Maps an Ollama tag to an mlx-community repo (via MODEL_MAPPING_FILE), drives
oMLX's /api/hf/download, and streams Ollama-style NDJSON progress. Embedding
models are served by a separate embed-only Ollama, so their "pull" is a no-op.
"""
import asyncio
import json
import os
from typing import Asyncgenerator if False else None  # placeholder import guard

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from src.config import settings  # upstream Settings singleton

router = APIRouter()

_OMLX = os.getenv("NOMAD_OMLX_BASE", "http://127.0.0.1:8000")
_OMLX_FALLBACK = os.getenv("NOMAD_OMLX_BASE_FALLBACK", "http://127.0.0.1:8080")
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")
_POLL_INTERVAL = 3.0
_POLL_MAX = 600  # ~30 min at 3s


def _is_embedding(name: str) -> bool:
    return "embed" in name.lower()


def _resolve_mlx_repo(name: str) -> str:
    mapping = {}
    try:
        mapping = settings.load_model_mappings() or {}
    except Exception:
        mapping = {}
    return mapping.get(name, name)


def _ndjson(obj: dict) -> str:
    return json.dumps(obj) + "\n"


async def _hf_download(client: httpx.AsyncClient, repo: str) -> str:
    """POST /api/hf/download against :8000 then :8080. Returns the base that worked."""
    for base in (_OMLX, _OMLX_FALLBACK):
        try:
            r = await client.post(f"{base}/api/hf/download", json={"model_id": repo})
            if r.status_code < 500:
                return base
        except Exception:
            continue
    raise RuntimeError("oMLX download API unreachable on :8000 or :8080")


async def _model_present(client: httpx.AsyncClient, base: str, repo: str) -> bool:
    try:
        r = await client.get(f"{base}/v1/models")
        data = r.json().get("data", [])
        return any(repo in (m.get("id", "")) for m in data)
    except Exception:
        return False


async def _pull_stream(name: str):
    """Yield Ollama-style NDJSON strings for pulling `name`."""
    if _is_embedding(name):
        # Embedding model lives on the embed-only Ollama; forward its pull stream.
        async with httpx.AsyncClient(timeout=None) as client:
            yield _ndjson({"status": f"pulling {name} (embedding, via embed Ollama)"})
            try:
                async with client.stream("POST", f"{_EMBED}/api/pull",
                                         json={"name": name}) as resp:
                    async for line in resp.aiter_lines():
                        if line.strip():
                            yield line + "\n"
            except Exception:
                pass  # embed model is usually already present; fall through to success
            yield _ndjson({"status": "success"})
        return

    repo = _resolve_mlx_repo(name)
    yield _ndjson({"status": "pulling manifest"})
    async with httpx.AsyncClient(timeout=None) as client:
        base = await _hf_download(client, repo)
        yield _ndjson({"status": "downloading", "digest": repo})
        for i in range(_POLL_MAX):
            if await _model_present(client, base, repo):
                yield _ndjson({"status": "verifying"})
                yield _ndjson({"status": "success"})
                return
            await asyncio.sleep(_POLL_INTERVAL)
            yield _ndjson({"status": "downloading", "digest": repo})
        yield _ndjson({"status": "error", "error": f"timed out downloading {repo}"})


@router.post("/pull")
async def pull(request: Request):
    body = await request.json()
    name = body.get("name") or body.get("model") or ""
    return StreamingResponse(_pull_stream(name), media_type="application/x-ndjson")
```

> Note: delete the bogus `from typing import Asyncgeneratorif False...` guard line — it is a deliberate tripwire so you read this code rather than paste it. The correct top imports are just `asyncio`, `json`, `os`, `httpx`, and the FastAPI symbols.

- [ ] **Step 4: Register ahead of upstream `/api`**

In `install/macos/omlx-proxy/vendor/src/main.py`, just **before** the existing `app.include_router(... prefix="/api" ...)` block (~line 206), add:

```python
from src.routers import nomad_pull  # noqa: E402
app.include_router(nomad_pull.router, prefix="/api", tags=["nomad-pull"])
```

Starlette matches earliest-registered first, so our `/api/pull` wins over `models.router`'s 501 stub; `/api/tags`, `/api/show`, `/api/version` still fall through to `models`.

- [ ] **Step 5: Run the test, verify it passes**

```bash
/tmp/proxy-test-venv/bin/python -m pytest tests/test_nomad_pull.py -q
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add install/macos/omlx-proxy/vendor/src/routers/nomad_pull.py \
        install/macos/omlx-proxy/vendor/src/main.py \
        install/macos/omlx-proxy/tests/test_nomad_pull.py
git commit -m "feat(omlx-proxy): /api/pull bridge to oMLX /api/hf/download (NDJSON)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B4: route `/api/embeddings` to the embed-only Ollama

**Files:**
- Create: `install/macos/omlx-proxy/vendor/src/routers/nomad_embed.py`
- Modify: `install/macos/omlx-proxy/vendor/src/main.py`
- Test: `install/macos/omlx-proxy/tests/test_nomad_embed.py` (create)

- [ ] **Step 1: Write the failing test**

Create `install/macos/omlx-proxy/tests/test_nomad_embed.py`:

```python
import os, sys
import httpx
import pytest
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))
os.environ.setdefault("OPENAI_API_KEY", "x")
os.environ.setdefault("OPENAI_API_BASE_URL", "http://127.0.0.1:8000/v1")
os.environ["NOMAD_EMBED_URL"] = "http://embed:11435"
from src.routers import nomad_embed  # noqa: E402


@pytest.mark.asyncio
async def test_embeddings_forwarded_to_embed_ollama(monkeypatch):
    captured = {}
    async def fake_post(self, url, json=None, **kw):
        captured["url"] = url; captured["json"] = json
        return httpx.Response(200, json={"embedding": [0.1, 0.2]})
    monkeypatch.setattr(nomad_embed.httpx.AsyncClient, "post", fake_post)
    out = await nomad_embed._forward({"model": "nomic-embed-text", "prompt": "hi"})
    assert captured["url"] == "http://embed:11435/api/embeddings"
    assert out["embedding"] == [0.1, 0.2]
```

- [ ] **Step 2: Run it, verify it fails**

```bash
/tmp/proxy-test-venv/bin/python -m pytest tests/test_nomad_embed.py -q
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `install/macos/omlx-proxy/vendor/src/routers/nomad_embed.py`:

```python
"""Route /api/embeddings to the embed-only Ollama (hybrid backend).

Keeps embedding vectors bit-identical to what Qdrant already holds, so a backend
switch never forces a reindex. Chat/generation still go to oMLX via the other
routers; only embeddings are diverted here.
"""
import os
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()
_EMBED = os.getenv("NOMAD_EMBED_URL", "http://127.0.0.1:11435")


async def _forward(body: dict) -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{_EMBED}/api/embeddings", json=body)
        return r.json()


@router.post("/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    return JSONResponse(await _forward(body))
```

- [ ] **Step 4: Register ahead of upstream `/api` embeddings**

In `vendor/src/main.py`, before the existing `/api` embeddings include (~line 208):

```python
from src.routers import nomad_embed  # noqa: E402
app.include_router(nomad_embed.router, prefix="/api", tags=["nomad-embed"])
```

- [ ] **Step 5: Run the test, verify it passes**

```bash
/tmp/proxy-test-venv/bin/python -m pytest tests/ -q
```
Expected: PASS (all proxy tests).

- [ ] **Step 6: Commit**

```bash
git add install/macos/omlx-proxy/vendor/src/routers/nomad_embed.py \
        install/macos/omlx-proxy/vendor/src/main.py \
        install/macos/omlx-proxy/tests/test_nomad_embed.py
git commit -m "feat(omlx-proxy): /api/embeddings → embed-only Ollama (hybrid, no reindex)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PART C — docs, man pages, and on-device verification

### Task C1: `man nomad-backend` + overview update

**Files:**
- Create: `install/macos/man/nomad-backend.1`
- Modify: `install/macos/man/nomad.1`
- Test: `install/macos/scripts/test-manpages.sh` (existing — must stay green)

- [ ] **Step 1: Write the man page**

Create `install/macos/man/nomad-backend.1` in mdoc, mirroring an existing page (e.g. `nomad-reset-ollama.1`) for header/footer/section conventions. Cover: SYNOPSIS (`nomad backend [show|ollama|omlx]`), DESCRIPTION (what each subcommand does, the eligibility gate, that the admin is unaffected), the three-process oMLX topology, and SEE ALSO (`nomad-install(1)`, `nomad-reset-ollama(1)`, `nomad-models(1)`).

- [ ] **Step 2: Lint**

```bash
mandoc -Tlint install/macos/man/nomad-backend.1
```
Expected: no errors (warnings acceptable per existing pages).

- [ ] **Step 3: Add to overview + drift guard**

In `nomad.1`, add `backend` to the command list (mirroring how `reset-ollama` is listed). Run the existing man-page drift test:

```bash
bash install/macos/scripts/test-manpages.sh
```
Expected: PASS — every command has a page; `backend` now covered.

- [ ] **Step 4: Commit**

```bash
git add install/macos/man/nomad-backend.1 install/macos/man/nomad.1
git commit -m "docs(man): nomad-backend(1) + overview entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task C2: README — backend choice in install + "What's different"

**Files:**
- Modify: `README.md`

🧭 Maxim 23/24 (caweis-authored prose): state facts, credit by contribution, verify claims. No grading of upstream.

- [ ] **Step 1: Note the choice in Install**

In the Install section, after the models sentence, add one factual sentence: that on Apple Silicon + macOS 15+, the installer recommends the oMLX engine (faster on long RAG context) and otherwise uses native Ollama, and the choice can be changed later with `nomad backend`.

- [ ] **Step 2: Add a "What's different" bullet**

Add: "Optional oMLX backend (Apple-MLX) selectable at install or via `nomad backend`; the admin is unchanged because a local proxy speaks the Ollama API on its behalf."

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document the selectable oMLX backend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task C3: on-device verification checklist (ship-gate)

**Files:**
- Create: `install/macos/omlx-proxy/VERIFY_ON_DEVICE.md`

This is the **hard ship-gate** from the spec — the oMLX-by-default recommendation does not go live until every box passes on a macOS 15 Apple-Silicon Mac. No code; a runbook.

- [ ] **Step 1: Write the checklist**

Create `install/macos/omlx-proxy/VERIFY_ON_DEVICE.md` covering:
- `brew tap jundot/omlx … && brew install omlx` succeeds; confirm the binary name + `omlx serve` flags match Task A6 (adjust if upstream differs).
- Fresh `nomad install --backend omlx` on a macOS 15 Apple-Silicon Mac brings up all three agents; `nomad check stack` is all-green.
- `/api/hf/download` actual request/response shape matches `nomad_pull.py` (`model_id` field, single `:8000` port). Adjust the bridge if not.
- Easy-Setup wizard model pull shows a progressing bar (NDJSON bridge works).
- Admin chat works; RAG/Wikipedia query returns grounded answers (embeddings via :11435).
- `nomad backend ollama` then `nomad backend omlx` round-trips with **no Qdrant reindex** and chat/RAG still work.
- Investigate MLX `nomic-embed-text` equivalence (the "still open" item) — only if pursuing the single-runtime simplification.

- [ ] **Step 2: Commit**

```bash
git add install/macos/omlx-proxy/VERIFY_ON_DEVICE.md
git commit -m "docs(omlx-proxy): on-device verification ship-gate checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final integration gate (after all tasks)

- [ ] Run the full off-device suite — all must pass:
  ```bash
  bash install/macos/scripts/test-omlx-backend.sh
  bash install/macos/scripts/test-omlx-model-map.sh
  bash install/macos/scripts/test-manpages.sh
  bash install/macos/scripts/test-reset-ollama.sh      # regression: native path intact
  bash install/macos/scripts/test-host-command-allowlist.sh
  /tmp/proxy-test-venv/bin/python -m pytest install/macos/omlx-proxy/tests/ -q
  bash -n install/macos/nomad
  ```
- [ ] Regression: `nomad install` with no `--backend` on a non-eligible/dev machine still selects Ollama and behaves exactly as before (read-through of the install branch).
- [ ] Push `main`; open the on-device verification as a tracked item; **do not** flip the default-recommendation ship-gate until `VERIFY_ON_DEVICE.md` passes on hardware.

---

## Self-review (completed by plan author)

**Spec coverage:** backend selection (A4–A5, A8) ✓; `recommend_backend` hardware gate (A2) ✓; macOS-15 floor (A2, picker A5, switch A12) ✓; oMLX LaunchAgent (A6) ✓; proxy + embed agents (A7) ✓; proxy `/api/pull` bridge with probe-both + polling (B3) ✓; embeddings hybrid (A7, B4) ✓; name map single-source (B2) ✓; `nomad backend` switch (A12) ✓; backend-aware check/reset/models (A9–A11) ✓; security 127.0.0.1 binds (A6/A7 plists) ✓; tests incl. matrix (A1–A4, B2–B4) ✓; docs/man (C1–C2) ✓; on-device ship-gate (C3) ✓. `/api/show`+`/api/version` — spec called for adds; reconciliation shows upstream already implements them (no task needed). "Parallel MLX tier table" — superseded by single-source map (B2) per DRY; reconciliation note added.

**Placeholder scan:** the only intentional non-runnable line is the tripwire import in B3 Step 3, explicitly called out and instructed to delete. No "TBD/handle errors/similar to" placeholders.

**Type/name consistency:** helper names (`_nomad_os_major`, `_nomad_arch`, `backend_eligible`, `recommend_backend`, `_load_backend`, `resolve_backend_choice`, `prompt_for_backend`, `step_omlx_native`, `step_omlx_proxy`, `step_ollama_embed`, `_reset_omlx_stack`, `cmd_backend`) and label vars (`OMLX_LABEL`/`PROXY_LABEL`/`EMBED_LABEL`) are used consistently across tasks. Proxy module names (`nomad_pull`, `nomad_embed`) and their tested symbols (`_pull_stream`, `_resolve_mlx_repo`, `_is_embedding`, `_forward`, `_POLL_INTERVAL`) match between implementation and tests.
