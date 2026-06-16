#!/usr/bin/env bash
# Static checks for the Meshtastic host serial->TCP bridge LaunchAgent in
# install/macos/nomad. The bridge runs socat between the first matching
# /dev/tty.{usbserial,usbmodem}* device and a TCP-LISTEN socket so the
# containerised Meshtastic stack (and any LAN client) can reach a USB-attached
# radio the host owns. socat is a deliberate dependency: a hand-rolled asyncio
# serial shim re-introduces the device-stall bugs socat already solved.
#
# This is a TEXT/LINT test only — it never bootstraps a LaunchAgent and never
# touches a real radio (both are HOST/RADIO-gated). It greps the nomad script
# for the expected additions and extracts heredoc bodies to temp files for
# `bash -n` / `plutil -lint`.
#
# Run: bash install/macos/scripts/test-mesh-bridge.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NOMAD="$ROOT/install/macos/nomad"
TS="$ROOT/admin/constants/host_commands.ts"

[[ -f "$NOMAD" ]] || { echo "FAIL missing $NOMAD" >&2; exit 1; }
[[ -f "$TS" ]]    || { echo "FAIL missing $TS"    >&2; exit 1; }

PASS=0 FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
# grep the nomad script for a fixed string (literal, line-anchored where useful)
has()  { if grep -qF "$2" "$NOMAD"; then ok "$1"; else bad "$1 — not found: $2"; fi; }
hasE() { if grep -qE "$2" "$NOMAD"; then ok "$1"; else bad "$1 — no match: $2"; fi; }

TMPDIR_T="$(mktemp -d -t nomad-mesh-bridge-test.XXXXXX)"
trap 'rm -rf "$TMPDIR_T"' EXIT

# ── P2-1: port reservation + constants ───────────────────────────────────────
echo "== P2-1: port + constants =="
# 4403 is the Meshtastic default TCP port; it must be reserved in NOMAD_PORTS so
# system-check flags a collision before the bridge tries to bind.
hasE "NOMAD_PORTS reserves 4403"            '^NOMAD_PORTS=.*\b4403\b'
has  "MESH_BRIDGE_LABEL constant"           "MESH_BRIDGE_LABEL='com.projectnomad.mesh-serial-bridge'"
hasE "MESH_BRIDGE_PLIST constant"           '^MESH_BRIDGE_PLIST=.*MESH_BRIDGE_LABEL'
hasE "MESH_BRIDGE_SCRIPT constant"          '^MESH_BRIDGE_SCRIPT='

# ── P2-2: bridge script heredoc (quoted; socat dumb pipe) ─────────────────────
echo "== P2-2: bridge script heredoc =="
# The body is emitted via a QUOTED heredoc so nothing expands at install time
# (the device glob and port arrive as $1/$2 ProgramArguments).
hasE "bridge script emitted via QUOTED heredoc" "cat > \"\\\$MESH_BRIDGE_SCRIPT\" <<'MESH_BRIDGE_EOF'"

# Extract the MESH_BRIDGE_EOF heredoc body to a temp file and lint it.
mesh_body="$TMPDIR_T/mesh-bridge.sh"
awk '/<<'\''MESH_BRIDGE_EOF'\''/{f=1;next} f&&/^MESH_BRIDGE_EOF$/{f=0} f{print}' "$NOMAD" > "$mesh_body"
if [[ -s "$mesh_body" ]]; then
  ok "extracted bridge script body ($(wc -l < "$mesh_body" | tr -d ' ') lines)"
else
  bad "bridge script body empty — heredoc markers wrong?"
fi
# socat-backed dumb pipe (NOT a hand-rolled asyncio serial shim).
if grep -qF 'socat' "$mesh_body"; then ok "body uses socat"; else bad "body must use socat (research §2 binding)"; fi
if grep -qE 'TCP-LISTEN:' "$mesh_body"; then ok "body has TCP-LISTEN socket"; else bad "body missing TCP-LISTEN"; fi
if grep -qE 'reuseaddr' "$mesh_body"; then ok "TCP-LISTEN reuseaddr"; else bad "TCP-LISTEN missing reuseaddr"; fi
if grep -qE 'fork' "$mesh_body"; then ok "TCP-LISTEN fork"; else bad "TCP-LISTEN missing fork"; fi
# Device auto-detect over the usbserial/usbmodem glob from $1.
if grep -qE '/dev/tty\.\{usbserial,usbmodem\}\*|usbserial|usbmodem' "$mesh_body"; then
  ok "body auto-detects /dev/tty.{usbserial,usbmodem}* device"
else
  bad "body missing usbserial/usbmodem device glob"
fi
if grep -qE '\$1' "$mesh_body" && grep -qE '\$2' "$mesh_body"; then
  ok "body takes \$1=device-glob \$2=tcp-port"
else
  bad "body must consume \$1 (glob) and \$2 (port)"
fi
# Logs under ~/Library/Logs and a graceful no-device exit 0 (KeepAlive respawns).
if grep -qE 'Library/Logs' "$mesh_body"; then ok "body logs under ~/Library/Logs"; else bad "body missing ~/Library/Logs"; fi
if grep -qE 'exit 0' "$mesh_body"; then ok "body exits 0 when no device (KeepAlive respawn)"; else bad "body missing graceful exit 0"; fi
# bash -n the extracted body.
if bash -n "$mesh_body" 2>"$TMPDIR_T/mesh.lint"; then
  ok "bridge script body passes bash -n"
else
  bad "bridge script body bash -n: $(cat "$TMPDIR_T/mesh.lint")"
fi

# ── P2-3: step_install_mesh_serial_bridge() + plist ──────────────────────────
echo "== P2-3: install step + plist =="
hasE "step_install_mesh_serial_bridge defined"   '^step_install_mesh_serial_bridge\(\)'
# Invoked in the install/refresh flow (at least once besides the def).
inv_count="$(grep -cE 'step_install_mesh_serial_bridge' "$NOMAD")"
if [[ "${inv_count:-0}" -ge 2 ]]; then
  ok "step_install_mesh_serial_bridge is invoked (refs=$inv_count)"
else
  bad "step_install_mesh_serial_bridge defined but never called (refs=$inv_count)"
fi
# Mirror the LaunchAgent idiom: chmod 644 plist, _la_clean_bootout, 3-attempt
# bootstrap, lsof port pre-check. Extract the function body and assert each
# construct appears WITHIN it (a whole-file grep would falsely match the
# OMLX/proxy steps that share the idiom). The port is referenced via
# $MESH_BRIDGE_PORT (==4403), matching the constant-not-literal idiom.
step_body="$TMPDIR_T/step.sh"
awk '/^step_install_mesh_serial_bridge\(\) \{/{f=1} f{print} f&&/^\}$/{exit}' "$NOMAD" > "$step_body"
inbody() { if grep -qE "$2" "$step_body"; then ok "$1"; else bad "$1 — not in step body: $2"; fi; }
if [[ -s "$step_body" ]]; then ok "extracted step_install_mesh_serial_bridge body"; else bad "step body empty"; fi
inbody "step does lsof port pre-check on the bridge port" 'lsof -nP -iTCP:"\$MESH_BRIDGE_PORT"'
inbody "step uses _la_clean_bootout for the bridge label" '_la_clean_bootout "\$LA_TARGET" "\$MESH_BRIDGE_LABEL"'
inbody "step chmod 644 the bridge plist"                  'chmod 644 "\$MESH_BRIDGE_PLIST"'
inbody "step has a 3-attempt bootstrap loop"             'for attempt in 1 2 3; do'
inbody "step bootstraps via launchctl"                   'launchctl bootstrap "\$LA_TARGET" "\$MESH_BRIDGE_PLIST"'
# Extract the mesh plist heredoc and plutil -lint it. The plist is emitted via
# an UNQUOTED heredoc (constants expand) keyed on MESH_BRIDGE_LABEL.
mesh_plist_raw="$TMPDIR_T/mesh.plist.raw"
awk '/cat > "\$MESH_BRIDGE_PLIST" <<EOF/{f=1;next} f&&/^EOF$/{f=0} f{print}' "$NOMAD" > "$mesh_plist_raw"
if [[ -s "$mesh_plist_raw" ]]; then
  ok "extracted mesh plist heredoc body"
else
  bad "mesh plist heredoc body empty — markers wrong?"
fi
# Assert the required plist fields are present in the raw body.
for field in '<key>Label</key>' '<key>ProgramArguments</key>' '/bin/bash' \
             '${MESH_BRIDGE_SCRIPT}' '<key>RunAtLoad</key>' '<key>KeepAlive</key>' \
             '<key>SuccessfulExit</key>' '<key>StandardOutPath</key>' '<key>StandardErrorPath</key>'; do
  if grep -qF "$field" "$mesh_plist_raw"; then ok "plist has $field"; else bad "plist missing $field"; fi
done
if grep -qE 'Library/Logs' "$mesh_plist_raw"; then ok "plist logs under ~/Library/Logs"; else bad "plist Std*Path not under ~/Library/Logs"; fi
# Substitute the shell-expanded vars so plutil sees a concrete plist, then lint.
mesh_plist="$TMPDIR_T/mesh.plist"
sed -e 's#${MESH_BRIDGE_LABEL}#com.projectnomad.mesh-serial-bridge#g' \
    -e 's#${MESH_BRIDGE_SCRIPT}#/tmp/mesh-serial-bridge.sh#g' \
    -e 's#${HOME}#/tmp/home#g' \
    -e 's#${mesh_glob}#/dev/tty.usbserial*#g' \
    -e 's#${mesh_port}#4403#g' \
    -e 's#${[A-Za-z_][A-Za-z0-9_]*}#X#g' \
    "$mesh_plist_raw" > "$mesh_plist"
if command -v plutil >/dev/null 2>&1; then
  if plutil -lint "$mesh_plist" >"$TMPDIR_T/plutil.out" 2>&1; then
    ok "mesh plist passes plutil -lint"
  else
    bad "mesh plist plutil -lint: $(cat "$TMPDIR_T/plutil.out")"
  fi
else
  ok "plutil unavailable — skipped lint (non-macOS CI)"
fi

# ── P2-4: uninstall symmetry + allow-list drift ──────────────────────────────
echo "== P2-4: uninstall symmetry + allow-list =="
# MESH_BRIDGE_LABEL must be in the uninstall bootout loop and MESH_BRIDGE_PLIST
# in the plist-removal loop.
if awk '/for label in/{f=1} f&&/MESH_BRIDGE_LABEL/{print;found=1} f&&/; do/{f=0} END{exit !found}' "$NOMAD" >/dev/null; then
  ok "MESH_BRIDGE_LABEL in uninstall bootout loop"
else
  bad "MESH_BRIDGE_LABEL not in uninstall bootout loop"
fi
if awk '/for plist in/{f=1} f&&/MESH_BRIDGE_PLIST/{print;found=1} f&&/; do/{f=0} END{exit !found}' "$NOMAD" >/dev/null; then
  ok "MESH_BRIDGE_PLIST in uninstall plist-removal loop"
else
  bad "MESH_BRIDGE_PLIST not in uninstall plist-removal loop"
fi
# MESH_BRIDGE_SCRIPT should be removed too (script-removal loop symmetry).
if grep -qE 'MESH_BRIDGE_SCRIPT' "$NOMAD"; then ok "MESH_BRIDGE_SCRIPT referenced in uninstall script loop"; else bad "MESH_BRIDGE_SCRIPT not cleaned on uninstall"; fi

# mesh-bridge-restart must be in BOTH the TS canonical list and the bash run_cmd case.
if grep -qE "'mesh-bridge-restart'" "$TS"; then ok "mesh-bridge-restart in host_commands.ts"; else bad "mesh-bridge-restart missing from host_commands.ts"; fi
if awk '/^run_cmd\(\)/{f=1} f&&/case "\$cmd" in/{c=1;next} c&&/^[[:space:]]*esac/{exit} c{print}' "$NOMAD" \
     | grep -qE 'mesh-bridge-restart\)'; then
  ok "mesh-bridge-restart) label in bash run_cmd case"
else
  bad "mesh-bridge-restart) not in bash run_cmd case"
fi
# run_cmd maps it to `nomad mesh-bridge restart`.
hasE "run_cmd maps mesh-bridge-restart -> nomad mesh-bridge restart" 'mesh-bridge-restart\).*mesh-bridge restart'

# ── whole-file lint ──────────────────────────────────────────────────────────
echo "== whole-file =="
if bash -n "$NOMAD" 2>"$TMPDIR_T/nomad.lint"; then
  ok "install/macos/nomad passes bash -n"
else
  bad "install/macos/nomad bash -n: $(cat "$TMPDIR_T/nomad.lint")"
fi

echo
echo "test-mesh-bridge: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
