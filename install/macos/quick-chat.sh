#!/usr/bin/env bash
# quick-chat.sh — portable Ollama bootstrapper for the NOMAD data drive.
# Lives on the drive so it travels with it. Run on ANY Mac:
#   bash /Volumes/<drive>/project-nomad/quick-chat.sh
# Result: native Ollama running, all the drive's cached models available, ready to chat.
#
# Does NOT install NOMAD. Just gets you LLM chat using the models on this drive.
# For the full NOMAD experience (admin UI / Wikipedia / RAG), install the bundle.

set -euo pipefail

C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'; C_HEAD=$'\033[1;36m'; C_OFF=$'\033[0m'
log()  { printf "%s==>%s %s\n"  "$C_HEAD" "$C_OFF" "$*"; }
ok()   { printf "%s ✓ %s%s\n"   "$C_OK"   "$*" "$C_OFF"; }
warn() { printf "%s ⚠ %s%s\n"   "$C_WARN" "$*" "$C_OFF"; }
die()  { printf "%s ✗ %s%s\n"   "$C_ERR"  "$*" "$C_OFF" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "macOS only — this is a Mac LLM bootstrapper"

DRIVE_ROOT="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$DRIVE_ROOT/ollama-models"
[[ -d "$MODELS_DIR" ]] || die "no ollama-models/ at $MODELS_DIR — is this the NOMAD data drive?"

log "Project NOMAD — quick-chat (portable LLM mode)"
echo "  drive:    $DRIVE_ROOT"
echo "  models:   $MODELS_DIR"
echo

# 1. Ensure ollama is installed
if ! command -v ollama >/dev/null 2>&1; then
  for o in /opt/homebrew/bin/ollama /usr/local/bin/ollama; do
    [[ -x "$o" ]] && export PATH="$(dirname "$o"):$PATH" && break
  done
fi
if ! command -v ollama >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    log "installing ollama via Homebrew"
    brew install ollama
  else
    die "ollama not installed and Homebrew not present.
Install Homebrew first:
  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"
Then re-run this script."
  fi
fi
ok "ollama $(ollama --version 2>&1 | head -1)"

# 2. If a NOMAD LaunchAgent is already running on this Mac, just use it.
if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  ok "ollama already serving on :11434 — using it"
else
  # Check if :11434 is squatted by something else
  if lsof -nP -iTCP:11434 -sTCP:LISTEN >/dev/null 2>&1; then
    warn ":11434 is in use but not responding. Stop the existing service first:"
    lsof -nP -iTCP:11434 -sTCP:LISTEN | head -3
    die "free :11434 then retry"
  fi
  log "starting ollama serve (Ctrl-C to stop the daemon when done)"
  log "models load lazily from the drive — first chat with each model is slower"
  echo
  export OLLAMA_MODELS="$MODELS_DIR"
  export OLLAMA_HOST="127.0.0.1:11434"
  export OLLAMA_KEEP_ALIVE="30m"
  export OLLAMA_FLASH_ATTENTION="1"
  export OLLAMA_KV_CACHE_TYPE="q8_0"
  # Allow browser pages (file:// or any local origin) to hit the API
  export OLLAMA_ORIGINS="*"
  ollama serve &
  OLLAMA_PID=$!
  trap 'kill $OLLAMA_PID 2>/dev/null || true' EXIT INT TERM

  # Wait for API
  for i in $(seq 1 15); do
    curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
  ok "ollama serving on http://127.0.0.1:11434"
fi

# 3. List models
echo
log "models on this drive:"
OLLAMA_MODELS="$MODELS_DIR" ollama list 2>/dev/null | tail -n +1

# 4. Open the browser chat UI (preferred) — falls back to terminal chat if HTML missing
echo
HTML_UI="$DRIVE_ROOT/quick-chat.html"
if [[ -f "$HTML_UI" && -z "${1:-}" ]]; then
  log "opening browser chat: $HTML_UI"
  open "$HTML_UI"
  echo
  echo "  Browser tab is now talking to Ollama on http://127.0.0.1:11434"
  echo "  When you're done, return to this terminal and Ctrl-C to stop ollama serve."
  echo
  # Keep the daemon alive in the foreground until user quits
  wait "$OLLAMA_PID" 2>/dev/null
else
  # Terminal fallback — pass a model name as $1 to skip browser
  DEFAULT_MODEL="${1:-}"
  if [[ -z "$DEFAULT_MODEL" ]]; then
    DEFAULT_MODEL="$(OLLAMA_MODELS="$MODELS_DIR" ollama list 2>/dev/null | awk 'NR>1 {print $1, $3}' | sort -k2 -h | head -1 | awk '{print $1}')"
  fi
  if [[ -n "$DEFAULT_MODEL" ]]; then
    log "starting terminal chat with $DEFAULT_MODEL  (Ctrl-D or /bye to exit)"
    echo
    OLLAMA_MODELS="$MODELS_DIR" ollama run "$DEFAULT_MODEL"
  else
    warn "no models found on the drive at $MODELS_DIR"
    warn "to pull one: ollama pull llama3.2:3b"
  fi
fi
