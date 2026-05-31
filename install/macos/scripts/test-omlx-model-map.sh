#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NOMAD="$ROOT/install/macos/nomad"
MAP="$ROOT/install/macos/omlx-proxy/config/model_map.json"
[[ -f "$NOMAD" ]] || { echo "missing $NOMAD"; exit 1; }
[[ -f "$MAP" ]]   || { echo "missing $MAP"; exit 1; }

# model_map.json must be valid JSON.
python3 -c "import json,sys; json.load(open('$MAP'))" || { echo "FAIL model_map.json is not valid JSON"; exit 1; }

# Every model token across all TIER_* defs must have a key in model_map.json.
tier_models="$(grep -E '^TIER_(TINY|SMALL|MEDIUM|LARGE|XL|DREAMY)=' "$NOMAD" \
  | sed -E 's/^[^=]+="//; s/"$//' | tr ' ' '\n' | sort -u | grep -v '^$')"
missing=0
while IFS= read -r m; do
  [[ -z "$m" ]] && continue
  if ! grep -q "\"$m\"" "$MAP"; then echo "FAIL no map entry for tier model: $m"; missing=$((missing+1)); fi
done <<< "$tier_models"

if [[ $missing -eq 0 ]]; then echo "ok  every tier model has an mlx map entry; JSON valid"; else echo "FAIL $missing tier model(s) unmapped"; fi
[[ $missing -eq 0 ]]
