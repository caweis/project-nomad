# Host-command allow-list single-source — design

**Date:** 2026-05-30
**Branch:** `feat/macos-distribution-layer`
**Components:** `admin/` (AdonisJS backend + Inertia frontend, TypeScript) + `install/macos/nomad` (host bash CLI) + a new CI workflow
**Status:** Approved design — ready for implementation plan

---

## Problem

The host-command-bridge allow-list — the set of commands the admin UI is
permitted to trigger on the host — is currently duplicated across three places
that must be kept in sync by hand:

1. **Backend allow-list** — `admin/app/controllers/host_commands_controller.ts`
   `ALLOWED_COMMANDS = new Set([...6 names...])` (request validation).
2. **Frontend type** — `admin/inertia/components/HostCommandButton.tsx`
   `export type HostCommandName = '...' | '...' | ...` (button prop type).
3. **Host action map** — `install/macos/nomad` `run_cmd()` `case "$cmd" in …`,
   which maps each name to a host action (`upgrade-ollama → "$NOMAD_BIN" upgrade
   ollama`, etc.) and runs under the `com.projectnomad.host-command-bridge`
   LaunchAgent.

All three list the same six names: `upgrade-ollama`, `upgrade-admin`,
`upgrade-all`, `reset-ollama`, `fix-kiwix`, `self-update`. Adding or renaming a
command means editing three files in two languages; missing one causes a silent
mismatch (a button that 400s, or a name the controller accepts but the host
rejects).

## Security constraint (do not weaken)

The `run_cmd` `case` statement is the **security boundary** of the bridge. Per
the bridge threat model: requests are filename-only (the `.pending` filename
*is* the command — no JSON, no token, no string interpolation from
user-controlled content), and the `case` allow-list is the boundary against
arbitrary shell injection. Any single-sourcing must preserve this: the host
must not parse a runtime manifest or dynamically dispatch actions from data.

## Goal

Make the **command-name list** single-sourced where it's cheap and safe (the two
TypeScript consumers), and **drift-detected** where single-sourcing would weaken
security (the bash boundary). Adding a command should require editing the
canonical list + the bash action map only, with CI catching any divergence.

## Non-goals

- Adding, removing, or renaming any bridge command. This is pure de-duplication
  of the existing six.
- Codegenerating the bash `case` from a manifest (rejected: adds a build step to
  the host script and moves the security-critical action map into a generator
  template — harder to audit).
- A runtime JSON manifest read by the LaunchAgent (rejected: injects parsing +
  dynamic dispatch into the security-critical bridge).
- Deriving button *labels* from the manifest. Labels are per-use-site contextual
  strings (`"Update"`, `"Reset"`), not per-command. YAGNI.

## Design

### Canonical source — `admin/constants/host_commands.ts` (new)

Follows the established `admin/constants/` pattern (`service_names.ts`,
`broadcast.ts`) already imported by both the backend (`app/…` via
`../../constants/x.js`) and the frontend (`inertia/…` via `../../constants/x`).

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

### Backend — `host_commands_controller.ts`

```ts
import { HOST_COMMANDS } from '../../constants/host_commands.js'
// …
private static readonly ALLOWED_COMMANDS = new Set<string>(HOST_COMMANDS)
```

The 400-error `allowed: Array.from(HostCommandsController.ALLOWED_COMMANDS)`
continues to work unchanged.

### Frontend — `HostCommandButton.tsx`

Delete the inline union; re-export the canonical type so existing
`import { HostCommandName }` sites (if any are added later) keep resolving from
the same module path:

```ts
export type { HostCommandName } from '../../constants/host_commands'
```

`HostCommandButtonProps.cmd: HostCommandName` is unchanged. The TS compiler now
enforces that the controller and the button reference the identical name set
(both flow from `HOST_COMMANDS`).

### Host — `install/macos/nomad`

`run_cmd()` is **functionally unchanged** (the action map is the boundary). Add
one comment above the `case` pointing to the canonical const + the consistency
test, so a future editor knows the list is mirrored and checked:

```bash
  # Allow-list MIRRORS admin/constants/host_commands.ts (the canonical name
  # list). This case is the security boundary (hand-authored, not generated).
  # Drift is caught by install/macos/scripts/test-host-command-allowlist.sh (CI).
  case "$cmd" in
```

### Drift guard — `install/macos/scripts/test-host-command-allowlist.sh` (new)

A portable bash test (grep/sort/comm — no `mktemp`, no macOS-isms) that:

1. Extracts the names from the TS const: lines between `HOST_COMMANDS = [` and
   `] as const`, pulling each single-quoted token.
2. Extracts the bash case labels from `run_cmd`: lines between `case "$cmd" in`
   and the closing `esac`, taking the label before `)` and excluding `*`.
3. Asserts the two **sorted sets are identical** — reports any name in TS but
   not bash (missing host action) and any in bash but not TS (un-listed
   command). Non-zero exit on any difference.

### CI — `.github/workflows/checks.yml` (new)

The repo currently has no PR/test workflow (all workflows are
`workflow_dispatch` or build-image-on-push). Add a small one that runs on
`macos-latest` (these are macOS install scripts — testing on the target OS
avoids BSD/GNU `mktemp`/`df` divergence) and on the relevant paths:

```yaml
name: Shell checks
on:
  push:
    branches: [feat/macos-distribution-layer, main]
    paths: ['install/macos/**', 'admin/constants/host_commands.ts']
  pull_request:
    paths: ['install/macos/**', 'admin/constants/host_commands.ts']
jobs:
  shell-checks:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Allow-list drift guard
        run: bash install/macos/scripts/test-host-command-allowlist.sh
      - name: Recovery helper unit tests
        run: bash install/macos/scripts/test-reset-ollama.sh
      - name: nomad syntax
        run: bash -n install/macos/nomad
```

This also retroactively gives the ① recovery suite CI coverage.

## Testing

- The consistency script **is** the drift test (run locally + in CI).
- `cd admin && npm run typecheck` proves the controller + button compile against
  the shared const (catches a bad import path or type error).
- The ① recovery suite stays green (`test-reset-ollama.sh`).
- Manual: temporarily add a 7th name to the TS const without touching bash →
  the consistency script must fail; revert.

## Files touched

- **Create** `admin/constants/host_commands.ts`
- **Create** `install/macos/scripts/test-host-command-allowlist.sh`
- **Create** `.github/workflows/checks.yml`
- **Modify** `admin/app/controllers/host_commands_controller.ts` (import + Set)
- **Modify** `admin/inertia/components/HostCommandButton.tsx` (import/re-export type)
- **Modify** `install/macos/nomad` (one comment above `run_cmd`'s `case`)

## Open implementation questions (resolve in writing-plans)

- Exact awk/grep extraction for the TS const: handle both `'name',` and a
  potential trailing-comma-less last entry; ignore the `as const` line.
- Whether the consistency script should also assert the controller's
  `ALLOWED_COMMANDS` references `HOST_COMMANDS` (vs re-listing) — likely
  unnecessary since `npm run typecheck` + the import already guarantee it; keep
  the script focused on the cross-language (TS↔bash) boundary it alone can check.
