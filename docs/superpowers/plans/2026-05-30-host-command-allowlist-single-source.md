# Host-command Allow-list Single-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the host-command-bridge allow-list from three hand-synced copies to one canonical TypeScript const, with a CI drift-guard protecting the bash security boundary that can't share the import.

**Architecture:** A new `admin/constants/host_commands.ts` (following the existing `constants/` pattern) becomes the single source. The controller imports it for `ALLOWED_COMMANDS`; the button re-exports its derived `HostCommandName` type (TS compiler enforces both agree). The bash `run_cmd` case in `install/macos/nomad` stays hand-authored (it's the security boundary) and a portable consistency test asserts its labels match the canonical list, run in a new `macos-latest` CI workflow.

**Tech Stack:** TypeScript (AdonisJS backend + Inertia/React frontend), bash, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-30-host-command-allowlist-single-source-design.md`

---

## File Structure

- **Create** `admin/constants/host_commands.ts` — canonical name list + derived type.
- **Modify** `admin/app/controllers/host_commands_controller.ts` — import the const; build `ALLOWED_COMMANDS` from it.
- **Modify** `admin/inertia/components/HostCommandButton.tsx` — delete inline union; re-export the canonical type.
- **Modify** `install/macos/nomad` — one comment above `run_cmd`'s `case` (no functional change).
- **Create** `install/macos/scripts/test-host-command-allowlist.sh` — cross-language drift guard.
- **Create** `.github/workflows/checks.yml` — runs the drift guard + recovery suite on `macos-latest`.

---

## Task 1: Canonical const

**Files:**
- Create: `admin/constants/host_commands.ts`

- [ ] **Step 1: Create the canonical module**

Create `admin/constants/host_commands.ts`:

```ts
/**
 * Canonical host-command-bridge command names — single source of truth for the
 * backend allow-list (HostCommandsController.ALLOWED_COMMANDS) and the frontend
 * button type (HostCommandName).
 *
 * The host-side action map — run_cmd()'s `case` in install/macos/nomad — maps
 * each of these names to a host action and is the bridge's SECURITY BOUNDARY.
 * It is hand-authored (deliberately not generated) and kept in sync with this
 * list by install/macos/scripts/test-host-command-allowlist.sh (run in CI).
 */
export const HOST_COMMANDS = [
  'upgrade-ollama',
  'upgrade-admin',
  'upgrade-all',
  'reset-ollama',
  'fix-kiwix',
  'self-update',
] as const

export type HostCommandName = (typeof HOST_COMMANDS)[number]
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd admin && npm run typecheck`
Expected: PASS (no errors). The new file is valid TS and not yet imported anywhere.

- [ ] **Step 3: Commit**

```bash
git add admin/constants/host_commands.ts
git commit -m "admin: canonical host-command name list (constants/host_commands.ts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire the controller to the canonical const

**Files:**
- Modify: `admin/app/controllers/host_commands_controller.ts`

- [ ] **Step 1: Add the import**

In `admin/app/controllers/host_commands_controller.ts`, the top imports are:

```ts
import type { HttpContext } from '@adonisjs/core/http'
import { promises as fs } from 'fs'
import path from 'path'
import logger from '@adonisjs/core/services/logger'
```

Add below them:

```ts
import { HOST_COMMANDS } from '../../constants/host_commands.js'
```

- [ ] **Step 2: Replace the inline Set with the canonical list**

Find:

```ts
  // Must match the allow-list in the LaunchAgent's run_cmd() case statement
  // (install/macos/nomad — host-command-bridge.sh body).
  private static readonly ALLOWED_COMMANDS = new Set([
    'upgrade-ollama',
    'upgrade-admin',
    'upgrade-all',
    'reset-ollama',
    'fix-kiwix',
    'self-update',
  ])
```

Replace with:

```ts
  // Canonical name list lives in constants/host_commands.ts; the bash run_cmd()
  // case in install/macos/nomad is the matching security boundary (kept in sync
  // by install/macos/scripts/test-host-command-allowlist.sh).
  private static readonly ALLOWED_COMMANDS = new Set<string>(HOST_COMMANDS)
```

- [ ] **Step 3: Verify type-check passes**

Run: `cd admin && npm run typecheck`
Expected: PASS. `Array.from(...ALLOWED_COMMANDS)` in the 400 handler still resolves to `string[]`.

- [ ] **Step 4: Commit**

```bash
git add admin/app/controllers/host_commands_controller.ts
git commit -m "admin: controller allow-list from canonical HOST_COMMANDS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the button to the canonical type

**Files:**
- Modify: `admin/inertia/components/HostCommandButton.tsx`

- [ ] **Step 1: Replace the inline union with a re-export**

In `admin/inertia/components/HostCommandButton.tsx`, find:

```ts
/**
 * Allow-listed host commands. Must stay in sync with:
 *   - admin/app/controllers/host_commands_controller.ts ALLOWED_COMMANDS
 *   - install/macos/nomad host-command-bridge.sh case statement (~line 2704)
 */
export type HostCommandName =
  | 'upgrade-ollama'
  | 'upgrade-admin'
  | 'upgrade-all'
  | 'reset-ollama'
  | 'fix-kiwix'
  | 'self-update'
```

Replace with:

```ts
// HostCommandName is derived from the canonical name list in
// constants/host_commands.ts (shared with the backend controller). Re-exported
// here so existing `import { HostCommandName } from './HostCommandButton'` sites
// keep resolving.
export type { HostCommandName } from '../../constants/host_commands'
```

(`HostCommandButtonProps.cmd: HostCommandName` below it is unchanged and now
references the re-exported type.)

- [ ] **Step 2: Verify type-check passes**

Run: `cd admin && npm run typecheck`
Expected: PASS. The `cmd: HostCommandName` prop and all `<HostCommandButton cmd="upgrade-ollama" />` call sites still type-check against the identical name set.

- [ ] **Step 3: Commit**

```bash
git add admin/inertia/components/HostCommandButton.tsx
git commit -m "admin: HostCommandName re-exported from canonical const

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Signpost the bash security boundary

**Files:**
- Modify: `install/macos/nomad` (`run_cmd`, ~line 2822)

- [ ] **Step 1: Add the keep-in-sync comment**

In `install/macos/nomad`, find:

```bash
run_cmd() {
  local cmd="$1"
  case "$cmd" in
    upgrade-ollama)  "$NOMAD_BIN" upgrade ollama ;;
```

Replace those lines with (inserting the comment above the `case`):

```bash
run_cmd() {
  local cmd="$1"
  # Allow-list MIRRORS admin/constants/host_commands.ts (the canonical name
  # list). This case is the bridge's security boundary — hand-authored, NOT
  # generated. Drift is caught by
  # install/macos/scripts/test-host-command-allowlist.sh (CI).
  case "$cmd" in
    upgrade-ollama)  "$NOMAD_BIN" upgrade ollama ;;
```

- [ ] **Step 2: Verify syntax still parses**

Run: `bash -n install/macos/nomad && echo "SYNTAX OK"`
Expected: `SYNTAX OK`.

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: signpost run_cmd allow-list as canonical-mirrored boundary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Cross-language drift guard

**Files:**
- Create: `install/macos/scripts/test-host-command-allowlist.sh`

- [ ] **Step 1: Write the drift-guard script**

Create `install/macos/scripts/test-host-command-allowlist.sh`:

```bash
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
```

- [ ] **Step 2: Make it executable; verify it PASSES on the synced tree**

Run: `chmod +x install/macos/scripts/test-host-command-allowlist.sh && bash install/macos/scripts/test-host-command-allowlist.sh`
Expected: `ok  allow-list in sync (6 commands)`, exit 0.

- [ ] **Step 3: Verify it FAILS on injected drift (no tree changes left behind)**

Run:
```bash
tmp="$(mktemp -d)"; cp -R admin install "$tmp"/
# inject a 7th name into the copied TS const only
sed -i.bak "s/  'self-update',/  'self-update',\n  'rm-rf-everything',/" "$tmp/admin/constants/host_commands.ts"
ROOTOVERRIDE="$tmp" bash -c '
  TS="$ROOTOVERRIDE/admin/constants/host_commands.ts"; NOMAD="$ROOTOVERRIDE/install/macos/nomad"
  ts=$(sed -n "/HOST_COMMANDS = \[/,/\]/p" "$TS" | grep -oE "'"'"'[^'"'"']+'"'"'" | tr -d "'"'"'" | sort)
  bn=$(awk "/^run_cmd\(\)/{f=1} f&&/case \"\$cmd\" in/{c=1;next} c&&/^[[:space:]]*esac/{exit} c{print}" "$NOMAD" | grep -oE "^[[:space:]]*[a-z][a-z0-9-]*\)" | tr -d " )" | sort)
  [[ "$ts" != "$bn" ]] && echo "DRIFT DETECTED (expected)" || echo "NO DRIFT (unexpected!)"
'
rm -rf "$tmp"
```
Expected: `DRIFT DETECTED (expected)`. (This proves the comparison catches a TS-side addition; it runs against a throwaway copy so the working tree is untouched.)

- [ ] **Step 4: Commit**

```bash
git add install/macos/scripts/test-host-command-allowlist.sh
git commit -m "test: cross-language drift guard for host-command allow-list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: CI workflow

**Files:**
- Create: `.github/workflows/checks.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/checks.yml`:

```yaml
name: Shell checks

# Lightweight checks for the macOS distribution layer. Runs on macos-latest so
# the bash tests exercise the same BSD userland (df, mktemp, awk) as the target.
on:
  push:
    branches: [feat/macos-distribution-layer, main]
    paths:
      - 'install/macos/**'
      - 'admin/constants/host_commands.ts'
      - '.github/workflows/checks.yml'
  pull_request:
    paths:
      - 'install/macos/**'
      - 'admin/constants/host_commands.ts'
      - '.github/workflows/checks.yml'

jobs:
  shell-checks:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: nomad syntax
        run: bash -n install/macos/nomad
      - name: Host-command allow-list drift guard
        run: bash install/macos/scripts/test-host-command-allowlist.sh
      - name: Recovery helper unit tests
        run: bash install/macos/scripts/test-reset-ollama.sh
```

- [ ] **Step 2: Validate the YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/checks.yml')); print('YAML OK')"`
Expected: `YAML OK`. (If PyYAML isn't installed, run `python3 -c "import json; print('skip')"` is not equivalent — instead confirm structure by eye; note in report.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/checks.yml
git commit -m "ci: shell-checks workflow (allow-list drift + recovery suite)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the admin**

Run: `cd admin && npm run typecheck`
Expected: PASS — controller + button compile against the shared const.

- [ ] **Step 2: Run the drift guard**

Run: `bash install/macos/scripts/test-host-command-allowlist.sh`
Expected: `ok  allow-list in sync (6 commands)`.

- [ ] **Step 3: Run the recovery suite (regression)**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: `23 passed, 0 failed`.

- [ ] **Step 4: Confirm no inline allow-list remains in the two TS files**

Run:
```bash
grep -c "upgrade-ollama" admin/app/controllers/host_commands_controller.ts admin/inertia/components/HostCommandButton.tsx
```
Expected: `0` for both files (the literal name now lives only in `constants/host_commands.ts` and `install/macos/nomad`).

- [ ] **Step 5: Final report**

Summarize: typecheck result, drift-guard result, recovery-suite result, the grep-0 confirmation, and confirm the CI workflow lands on the right paths. Note that the CI job's first real run happens on the next push/PR matching the paths.

---

## Self-Review (completed during plan authoring)

**Spec coverage:**
- Canonical `host_commands.ts` (const + derived type) → Task 1. ✓
- Controller imports it → Task 2. ✓
- Button re-exports the type → Task 3. ✓
- Bash boundary unchanged + signpost comment → Task 4. ✓
- Cross-language consistency test (both-direction set equality) → Task 5. ✓
- CI workflow on macos-latest, relevant paths, runs drift guard + recovery suite → Task 6. ✓
- Testing: typecheck + drift guard + recovery regression + grep-0 → Task 7. ✓
- Non-goals honored: no new commands, no codegen, no runtime manifest, no label derivation. ✓
- Security constraint honored: `run_cmd` case logic untouched (Task 4 adds only a comment). ✓

**Placeholder scan:** none — every step has literal code/commands. The Task 5 extraction commands were dry-run-verified against the real files before this plan was written (both sides produce the same sorted 6-name list).

**Type/name consistency:** `HOST_COMMANDS` (const), `HostCommandName` (derived type), `ALLOWED_COMMANDS` (Set) used consistently across Tasks 1–3. Import paths: backend `../../constants/host_commands.js` (matches existing `service_names.js` precedent), frontend `../../constants/host_commands` (no extension, matches Vite precedent). Script path `install/macos/scripts/test-host-command-allowlist.sh` consistent across Tasks 5, 6, 7 and the spec.

**Open items deferred to execution (from spec):** the TS-extraction `sed` range (`HOST_COMMANDS = [` … `]`) is verified to ignore the `as const` line (no quotes on it); the script focuses solely on the TS↔bash boundary (controller↔button agreement is guaranteed by `tsc`).
