#!/usr/bin/env bash
# Drift guard: the bash run_cmd() allow-list in install/macos/nomad (the bridge
# SECURITY BOUNDARY) must exactly match the canonical TS name list in
# admin/constants/host_commands.ts. Fails (non-zero) if they diverge.
#
# Run: bash install/macos/scripts/test-host-command-allowlist.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TS="$ROOT/admin/constants/host_commands.ts"
NOMAD="$ROOT/install/macos/nomad"

[[ -f "$TS" ]]    || { echo "FAIL missing $TS" >&2; exit 1; }
[[ -f "$NOMAD" ]] || { echo "FAIL missing $NOMAD" >&2; exit 1; }

# Names from the TS const: the single-quoted tokens inside HOST_COMMANDS = [ ... ]
ts_names="$(sed -n '/HOST_COMMANDS = \[/,/\]/p' "$TS" \
  | grep -oE "'[^']+'" | tr -d "'" | sort)"

# Labels from the bash run_cmd() case: the `name)` labels (excludes the `*)` default)
bash_names="$(awk '/^run_cmd\(\)/{f=1} f&&/case "\$cmd" in/{c=1;next} c&&/^[[:space:]]*esac/{exit} c{print}' "$NOMAD" \
  | grep -oE '^[[:space:]]*[a-z][a-z0-9-]*\)' | tr -d ' )' | sort)"

if [[ -z "$ts_names" ]];   then echo "FAIL extracted 0 names from TS const — parser drift?" >&2; exit 1; fi
if [[ -z "$bash_names" ]]; then echo "FAIL extracted 0 labels from run_cmd — parser drift?" >&2; exit 1; fi

if [[ "$ts_names" == "$bash_names" ]]; then
  echo "ok  allow-list in sync ($(echo "$ts_names" | grep -c . ) commands)"
  exit 0
fi

echo "FAIL allow-list drift between TS const and bash run_cmd:" >&2
echo "  only in TS const (no host action):"  >&2; comm -23 <(echo "$ts_names") <(echo "$bash_names") | sed 's/^/    /' >&2
echo "  only in bash case (not allow-listed):" >&2; comm -13 <(echo "$ts_names") <(echo "$bash_names") | sed 's/^/    /' >&2
exit 1
