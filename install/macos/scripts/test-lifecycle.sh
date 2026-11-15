#!/usr/bin/env bash
# Exercise the real lifecycle orchestration with host/daemon boundaries replaced.
# No HOME override and no access to live containers, launch agents or data drives.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
TEST_ROOT="$(mktemp -d -t nomad-lifecycle.XXXXXX)"
trap 'rc=$?; if [[ $rc -ne 0 ]]; then tail -30 "$TEST_ROOT"/*.log 2>/dev/null || true; fi; rm -rf "$TEST_ROOT"' EXIT
export SECRETS_DIR="$TEST_ROOT/secrets"
NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
HERE="$TEST_ROOT/bundle"
COMPOSE_BASE="$HERE/compose.yaml"
mkdir -p "$HERE" "$SECRETS_DIR" "$TEST_ROOT/data/storage" "$TEST_ROOT/prefix"
cp "$SCRIPT_DIR/../compose.yaml" "$COMPOSE_BASE"
DATA_ROOT_RESOLVED="$TEST_ROOT/data"
DATA_ROOT_ARG="$DATA_ROOT_RESOLVED"
EVENTS="$TEST_ROOT/events"
: > "$EVENTS"
printf keep > "$DATA_ROOT_RESOLVED/storage/keep.zim"
BACKEND=ollama; NOMAD_OFFLINE=1; SKIP_MODELS=1; KEEP_DATA=1; YES=1

# Explicit boundary stubs: none of these may call a real daemon or install tools.
for name in sudo_bootstrap prevent_sleep prompt_for_models prompt_for_backend warn_if_tier_above_auto step_deps step_data_root step_orbstack step_orbstack_tune_quiet step_self_install_to_path step_drop_desktop_tools step_set_local_hostname step_ollama_native step_wait_admin step_run_admin_migrations step_seed_admin_services step_seed_native_ollama_state step_install_qdrant_for_rag step_install_benchmark_patcher step_install_kiwix_self_heal step_install_bonjour_advertise step_install_host_command_bridge step_install_drive_detect step_install_mesh_serial_bridge step_build_distro_help_zim _reconcile_open_webui ensure_docker_path; do
  eval "$name() { printf '%s\\n' '$name' >> \"\$EVENTS\"; }"
done
sleep() { :; }
curl() { echo 'Unexpected network request' >&2; return 99; }
pull_one_model() { echo 'Unexpected model download' >&2; return 99; }
brew() { [[ "${1:-}" == --prefix ]] && printf '%s\n' "$TEST_ROOT/prefix"; }
launchctl() { return 1; }
pkill() { printf 'pkill stub\n' >> "$EVENTS"; }
confirm() { return 0; }
MISSING_IMAGE=0
BROKEN_CONFIG=0
docker() {
  printf 'docker %s\n' "$*" >> "$EVENTS"
  case "$*" in
    *'config --images'*) [[ "$BROKEN_CONFIG" == 0 ]] || return 9; printf 'fixture/admin:local\nfixture/redis:local\n' ;;
    'image inspect '*) [[ "$MISSING_IMAGE" == 0 ]] ;;
    *' pull'*|'pull '*) echo 'Unexpected pull in offline mode' >&2; return 99 ;;
    'compose '*|version|'network '*|'volume '*|'ps '*) return 0 ;;
    *) echo "Unexpected Docker command: $*" >&2; return 99 ;;
  esac
}
for name in LA_PLIST PATCHER_PLIST KIWIX_SELF_HEAL_PLIST BONJOUR_PLIST HOST_BRIDGE_PLIST DRIVE_DETECT_PLIST OMLX_PLIST PROXY_PLIST EMBED_PLIST MESH_BRIDGE_PLIST; do
  printf -v "$name" '%s/%s' "$TEST_ROOT" "$name"
done

cmd_install > "$TEST_ROOT/install.log" 2>&1
grep -q '^NOMAD_OFFLINE=1$' "$ENV_FILE"
grep -q -- 'up --pull never -d --force-recreate' "$EVENTS"
[[ "$(cat "$DATA_ROOT_RESOLVED/storage/keep.zim")" == keep ]]
original_secrets="$(grep -E '^(APP_KEY|DB_PASSWORD|MYSQL_ROOT_PASSWORD)=' "$ENV_FILE")"
step_secrets > /dev/null
[[ "$(grep -E '^(APP_KEY|DB_PASSWORD|MYSQL_ROOT_PASSWORD)=' "$ENV_FILE")" == "$original_secrets" ]]
printf 'PASS offline install keeps content and reinstall keeps credentials\n'

if ( MISSING_IMAGE=1; step_compose_pull ) > "$TEST_ROOT/missing.log" 2>&1; then echo 'FAIL missing image accepted'; exit 1; fi
grep -q "images aren't loaded" "$TEST_ROOT/missing.log"
printf 'PASS offline install rejects missing images\n'
if ( BROKEN_CONFIG=1; step_compose_pull ) > "$TEST_ROOT/config.log" 2>&1; then echo 'FAIL invalid compose config accepted'; exit 1; fi
printf 'PASS offline install rejects invalid compose config\n'

# cmd_update must exec the refreshed bundle with the recorded choices intact.
_reconcile_bundle_dir() { :; }
_refresh_bundle_from_main() { printf 'refresh %s\n' "$2" >> "$EVENTS"; }
cat > "$HERE/nomad" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$LIFECYCLE_ARGS"
[[ "$NOMAD_NO_SELF_UPDATE" == 1 ]]
SCRIPT
export LIFECYCLE_ARGS="$TEST_ROOT/update-args"
( cmd_update --branch test-review ) > "$TEST_ROOT/update.log" 2>&1
grep -qx install "$LIFECYCLE_ARGS"
grep -qx -- --no-models "$LIFECYCLE_ARGS"
grep -qx "$DATA_ROOT_RESOLVED" "$LIFECYCLE_ARGS"
grep -qx ollama "$LIFECYCLE_ARGS"
[[ "$(cat "$DATA_ROOT_RESOLVED/storage/keep.zim")" == keep ]]
printf 'PASS update reuses configuration and skips model downloads\n'

cmd_uninstall > "$TEST_ROOT/uninstall.log" 2>&1
[[ ! -e "$ENV_FILE" && ! -d "$NOMAD_STATE_ROOT_DEFAULT" ]]
[[ "$(cat "$DATA_ROOT_RESOLVED/storage/keep.zim")" == keep ]]
printf 'PASS uninstall --keep-data preserves content and removes disposable state\n'
printf '5 lifecycle scenarios passed\n'
