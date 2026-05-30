#!/usr/bin/env bash
# Drift guard: every nomad dispatcher command must have a man/nomad-<cmd>.1 page
# and vice-versa. Also mandoc-lints every page (ERROR-level is fatal).
# Run: bash install/macos/scripts/test-manpages.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NOMAD="$ROOT/install/macos/nomad"
MANDIR="$ROOT/install/macos/man"
FAIL=0

# 1. Commands from the dispatcher's SECOND `case "$CMD" in` (c==2 — the first is
#    the self-update gate). Match only label lines (token then `)`), split
#    alternations (up|down, help|--help|-h), drop *) default + flag-only tokens.
#    VERIFIED against the real file to yield exactly the 26 commands.
cmds="$(awk '/^case "\$CMD" in/{c++} c==2&&/^[[:space:]]*\*\)/{exit} c==2{print}' "$NOMAD" \
  | grep -oE '^[[:space:]]*[a-z][a-z0-9|.-]*\)' \
  | tr -d ' )' | tr '|' '\n' \
  | grep -vE '^(--help|-h)$' | grep -E '^[a-z]' | sort -u)"

# 2. Pages present (strip nomad- prefix and .1 suffix; ignore the overview).
pages="$(ls "$MANDIR"/nomad-*.1 2>/dev/null | xargs -n1 basename \
  | sed -E 's/^nomad-//; s/\.1$//' | sort -u)"

if [[ -z "$cmds" ]];  then echo "FAIL extracted 0 commands — dispatcher parse drift?" >&2; exit 1; fi
if [[ -z "$pages" ]]; then echo "FAIL no nomad-*.1 pages found in $MANDIR" >&2; exit 1; fi

missing="$(comm -23 <(echo "$cmds") <(echo "$pages"))"
orphan="$(comm -13 <(echo "$cmds") <(echo "$pages"))"
if [[ -n "$missing" ]]; then echo "FAIL commands with no man page:" >&2; echo "$missing" | sed 's/^/    /' >&2; FAIL=1; fi
if [[ -n "$orphan"  ]]; then echo "FAIL man pages with no command:" >&2; echo "$orphan"  | sed 's/^/    /' >&2; FAIL=1; fi

# 3. mandoc lint (ERROR-level only), if mandoc is present.
if command -v mandoc >/dev/null 2>&1; then
  local_err=0
  for mp in "$MANDIR"/nomad*.1; do
    if mandoc -Tlint "$mp" 2>&1 | grep -qi 'ERROR'; then
      echo "FAIL mandoc ERROR in $(basename "$mp"):" >&2
      mandoc -Tlint "$mp" 2>&1 | grep -i 'ERROR' | sed 's/^/    /' >&2
      local_err=1
    fi
  done
  [[ $local_err -eq 1 ]] && FAIL=1
else
  echo "note: mandoc not installed — skipped lint" >&2
fi

if [[ $FAIL -eq 0 ]]; then
  echo "ok  $(echo "$cmds" | grep -c .) commands ↔ pages in sync; pages lint clean"
  exit 0
fi
exit 1
