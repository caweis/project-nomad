#!/usr/bin/env bash
# Unit tests for offline mode (--offline / NOMAD_OFFLINE=1) in install/macos/nomad.
# Run:        bash install/macos/scripts/test-offline-mode.sh
#
# Sources the CLI under NOMAD_SOURCE_FOR_TEST=1 with SECRETS_DIR in a temp dir and
# a stub `docker` on PATH that records its arguments and answers `image inspect`
# from a list of "loaded" images.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
PASS=0 FAIL=0

ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

load() {
  TMP="$(mktemp -d -t nomad-offline-test.XXXXXX)"
  export SECRETS_DIR="$TMP"
  mkdir -p "$TMP/bin" "$TMP/pack/images"
  : > "$TMP/docker.log"; : > "$TMP/loaded"
  cat > "$TMP/bin/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$TMP/docker.log"
case "\$1 \$2" in
  "image inspect") grep -qxF "\$3" "$TMP/loaded" ;;
  "compose -f")    [[ " \$* " == *" config --images "* ]] && printf 'mysql:8.0\nredis:7-alpine\n'; exit 0 ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$TMP/bin/docker"
  export PATH="$TMP/bin:$PATH"
  printf 'NOMAD_DATA_ROOT=%s\nDB_PASSWORD=pw\n' "$TMP" > "$TMP/.env"
  NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
  set +e
  ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
  bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
  check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
  _admin_ollama_url() { echo http://host.docker.internal:11434; }
}

echo "== dc up adds --pull never only when offline =="
load
NOMAD_OFFLINE=0 dc up -d >/dev/null
check "online: no --pull flag" "$(grep -c -- '--pull never' "$TMP/docker.log")" "0"
NOMAD_OFFLINE=1 dc up -d --force-recreate >/dev/null
check "offline up: --pull never right after up" \
  "$(tail -1 "$TMP/docker.log" | grep -o 'up --pull never -d --force-recreate')" "up --pull never -d --force-recreate"
NOMAD_OFFLINE=1 dc restart admin >/dev/null
check "offline restart: untouched" "$(tail -1 "$TMP/docker.log" | grep -c -- '--pull')" "0"

echo "== offline pack dir =="
load
check "defaults to <data root>/offline-pack" "$(NOMAD_OFFLINE=1 _offline_pack_dir)" "$TMP/offline-pack"
check "NOMAD_OFFLINE_PACK overrides" "$(NOMAD_OFFLINE_PACK=/x/y _offline_pack_dir)" "/x/y"

echo "== step_compose_pull offline =="
load
echo "mysql:8.0" > "$TMP/loaded"
out="$(NOMAD_OFFLINE=1 step_compose_pull 2>&1)"; rc=$?
check "missing image → non-zero" "$rc" "1"
[[ "$out" == *"redis:7-alpine"* ]] && ok "names the missing image" || bad "missing image not named: $out"
printf 'mysql:8.0\nredis:7-alpine\n' > "$TMP/loaded"
NOMAD_OFFLINE=1 step_compose_pull >/dev/null 2>&1; rc=$?
check "all loaded → success" "$rc" "0"
check "no docker pull issued" "$(grep -c ' pull' "$TMP/docker.log")" "0"
check "NOMAD_OFFLINE=1 persisted in .env" "$(grep -c '^NOMAD_OFFLINE=1$' "$TMP/.env")" "1"

echo "== _apply_offline_catalog =="
load
printf '# comment\nnomad_kiwix_server\tghcr.io/kiwix/kiwix-serve:3.8.2\nnomad_flatnotes\tdullage/flatnotes:v5.5.4\nbad\tx:1'"'"';DROP\n' \
  > "$TMP/pack/images/catalog.tsv"
echo "ghcr.io/kiwix/kiwix-serve:3.8.2" > "$TMP/loaded"
echo "x:1';DROP" >> "$TMP/loaded"
NOMAD_OFFLINE=1 NOMAD_OFFLINE_PACK="$TMP/pack" _apply_offline_catalog pw >/dev/null 2>&1
check "one UPDATE for the loaded image" "$(grep -c 'UPDATE services' "$TMP/docker.log")" "1"
check "UPDATE targets kiwix with packed tag" \
  "$(grep -c "container_image='ghcr.io/kiwix/kiwix-serve:3.8.2'.*service_name='nomad_kiwix_server'" "$TMP/docker.log")" "1"
check "quoted row skipped" "$(grep -c 'DROP' "$TMP/docker.log")" "0"
NOMAD_OFFLINE=1 NOMAD_OFFLINE_PACK="$TMP/nope" _apply_offline_catalog pw >/dev/null 2>&1; rc=$?
check "no catalog.tsv → soft skip" "$rc" "0"

echo
echo "passed: $PASS  failed: $FAIL"
[[ $FAIL -eq 0 ]]
