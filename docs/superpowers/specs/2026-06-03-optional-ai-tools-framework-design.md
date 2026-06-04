---
type: design-spec
status: approved-pending-review
date: 2026-06-03
project: project-nomad (macOS/Apple-Silicon fork, caweis/project-nomad)
feature: Optional AI-tools framework
tags: [nomad, compose-profiles, host-command-bridge, open-webui, optional-tools, macos]
related:
  - "[[2026-06-02-ollama-coexist-with-omlx-design]]"
  - "docs/superpowers/plans/2026-06-02-ollama-coexist-and-local-ai-app.md (BACKLOG → NEXT BUILD)"
---

# Optional AI-tools framework — Design Spec

**Goal:** Make nomad-served AI tools (browser apps the appliance runs, reachable over the LAN, offline) first-class **optional** components — chosen at install time, and added/removed afterward from **both** the `nomad` CLI and the admin web GUI — built on **one DRY mechanism** that every tool reuses.

**Architecture:** Each optional tool is a Docker Compose service tagged with its **own Compose profile**, gated by the `COMPOSE_PROFILES` key in the install `.env` (a comma-separated list of enabled tool ids). A service with no profile always starts; a profiled service only starts when its id is in `COMPOSE_PROFILES` — that is the on/off switch, with no change to how `nomad` invokes Compose. A new `nomad tools` subcommand edits the list and brings the service up/down. The admin GUI toggles the same tools through the existing **host-command bridge** (paired allow-listed commands). This build delivers the framework and converts the already-shipped **Open WebUI** (chat, `:3000`) from always-on to profile-gated. **OpenHands (code, `:3001`) is explicitly out of scope here** — it plugs into this framework via its own fast-follow spec.

**Tech stack:** bash (`install/macos/nomad`, ~6400 lines), Docker Compose (`install/macos/compose.yaml`), AdonisJS 6 + Inertia/React (`admin/`), the host-command bridge (LaunchAgent marker-file IPC), groff man pages, Markdown docs.

---

## Scope

**In scope (this build):**
1. The generic optional-tool mechanism: per-tool Compose profiles + `COMPOSE_PROFILES` in `.env`.
2. `nomad tools` CLI subcommand (`list` / `<name> on` / `<name> off`).
3. Install-time per-tool prompt (default **OFF** — leanest appliance).
4. Convert **Open WebUI** to the first profile-gated tool (today it is unconditional, `c888d82`/`5182020`).
5. Migration: existing installs already running Open WebUI **keep it** (preserve-on-upgrade backfill).
6. Admin GUI: "AI Tools" section on Settings → Apps with a per-tool toggle, via paired host-command-bridge commands.
7. Docs: extend `mac-ai-assistant.md`, add an FAQ entry, new `nomad-tools.1` man page.
8. Uninstall: explicitly remove tool volumes (closes a latent leak — the `open-webui` volume is not label-caught today).

**Out of scope (deferred, separate specs):**
- **OpenHands** (the "code" tool) — its per-session runtime-sandbox container, offline runtime-image pre-pull, and 32 GB resource guard are a distinct problem. It will reuse this framework verbatim; only the OpenHands service definition + its specifics are new.
- Full MLX model catalog (already backlogged).
- Generalizing the bridge to carry arguments (paired commands are sufficient).

---

## Key terms

- **Tool id** — the canonical lowercase-hyphen identifier, identical across the service name, container suffix, Compose profile, CLI noun, and bridge command. First tool: `open-webui` → service `open-webui`, container `nomad_open-webui`, profile `open-webui`, CLI `nomad tools open-webui …`, bridge `tools-open-webui-on|off`.
- **`COMPOSE_PROFILES`** — Docker Compose's native env var (read from `--env-file`), a comma-separated list of active profile names. We store the set of enabled tool ids here. Empty/absent = no optional tools running.

---

## Design decisions

**D1 — Per-tool profiles, not a shared profile.** Each tool gets a profile equal to its tool id. `COMPOSE_PROFILES` is a comma-list. Enabling Open WebUI sets `COMPOSE_PROFILES=open-webui`; later, enabling both → `open-webui,openhands`. A single shared `tools` profile is rejected: it couples the tools (can't have one on and one off), which violates the "both off, opt into each" requirement.

**D2 — The profile lever needs no `dc` change.** `dc()` (nomad:707) already runs `docker compose -f "$COMPOSE_BASE" --env-file "$ENV_FILE" "$@"`, and Compose reads `COMPOSE_PROFILES` from `--env-file`. Gating a service = (a) add `profiles: [<id>]` to its block in `compose.yaml`, (b) keep/append its id in `COMPOSE_PROFILES`. All existing `dc up`/`dc restart` call sites then respect the profile automatically.

**D3 — Reuse `_env_upsert` for the flag write.** `_env_upsert KEY VALUE` (nomad:3043) is the only generic, macOS-safe, idempotent `.env` writer (already used for `NOMAD_AI_BACKEND`). `nomad tools` computes the new comma-list and calls `_env_upsert COMPOSE_PROFILES "<list>"`.

**D4 — Fresh-install default OFF.** The installer prompts per tool, mirroring `prompt_for_backend()` (nomad:2893): paste-safe `read -r -p` + `tr|xargs`, **Enter = decline (off)**. Declining all → `COMPOSE_PROFILES=` (empty). This is a behavior change: new installs no longer get Open WebUI out of the box (matches "leanest appliance").

**D5 — Preserve-on-upgrade (mandatory, the #1 risk).** Converting Open WebUI to profiled means a plain `nomad upgrade` would otherwise *stop* it for every current user (Compose drops services not in the active profile). Therefore, in **both** `step_compose_up` (nomad:3065) and `_upgrade_compose_stack` (nomad:4595), **before** `dc up`: if `docker inspect nomad_open-webui` succeeds and `open-webui` is not already in `COMPOSE_PROFILES`, backfill it via `_env_upsert`. One-time, idempotent, runs alongside `_reconcile_open_webui`. Nobody loses chat.

**D6 — Data posture: `off` keeps data; only uninstall removes it.** `nomad tools <id> off` stops + removes the *container* but never the volume — re-enabling restores chat history. There is **no** `--purge` flag. `cmd_uninstall` (nomad:4849) gains an explicit `docker volume rm open-webui` (and, generically, each known tool's volume), because these volumes use `name:` overrides (not project-prefixed) and are invisible to the existing `docker volume ls --filter label=…` sweep (nomad:4917) — a latent leak this build closes.

**D7 — GUI toggles = paired bridge commands.** The host-command bridge is argument-free (the marker file carries only the command name; `run_cmd` maps names to fixed `nomad` calls). So each tool gets two allow-list entries: `tools-open-webui-on` and `tools-open-webui-off`. The drift guard (`test-host-command-allowlist.sh`) stays a pure bijection between `admin/constants/host_commands.ts` and `run_cmd()`; each new name is two edits (TS const + `run_cmd` case), no test-script change.

**D8 — GUI state is derived from live container presence, not intent.** The admin Apps page already receives a `system.services` payload (a Docker query via the socket). A tool's toggle renders **on** iff its container (`nomad_<id>`) exists/runs — truthful, and avoids injecting `COMPOSE_PROFILES` into the admin container. After a toggle's bridge command completes (exit 0), the page reloads (the existing `installActivity`-complete pattern) and reflects new reality.

**D9 — CLI grammar:** `nomad tools` (list every known tool + on/off state) · `nomad tools <id> on` · `nomad tools <id> off`. Unknown id → error listing valid ids. `cmd_tools()` mirrors `cmd_backend()`'s shape and slots into the dispatcher at nomad:~6375 as `tools) cmd_tools "${EXTRA_ARGS[@]}" ;;`.

**D10 — Tool registry is a single source in the script.** A small declarative table in `nomad` maps each tool id → its container name, port, volume name, and one-line description. `cmd_tools`, the installer prompt, the uninstall volume cleanup, and `nomad check` port handling all read this table. Adding a tool later (OpenHands) = one table row + one compose service + one bridge pair + one doc mention.

---

## File map

**Modify:**
- `install/macos/compose.yaml` — add `profiles: [open-webui]` to the `open-webui` service (volume decl unchanged).
- `install/macos/nomad`:
  - new `cmd_tools()` + tool registry table + `_tools_*` helpers (list/enable/disable, COMPOSE_PROFILES list math);
  - dispatcher arm `tools)` (also keeps `test-manpages.sh` green);
  - D5 preserve-on-upgrade backfill in `step_compose_up` + `_upgrade_compose_stack`;
  - install flow: per-tool prompt (default off) writing `COMPOSE_PROFILES`;
  - `run_cmd()` (nomad:3680): add `tools-open-webui-on)` / `tools-open-webui-off)` arms;
  - `cmd_uninstall` (nomad:4849): explicit `docker volume rm` for each tool volume;
  - `NOMAD_PORTS` comment/handling: note `:3000` is conditional on the `open-webui` tool.
- `admin/constants/host_commands.ts` — add `'tools-open-webui-on'`, `'tools-open-webui-off'`.
- `admin/app/controllers/settings_controller.ts` — `apps()` passes an `optionalTools` prop derived from running services.
- `admin/inertia/pages/settings/apps.tsx` — new "AI Tools" section: a `Switch` per tool wired to the paired bridge commands; reload on completion.
- `admin/docs/mac-ai-assistant.md` — "Optional AI tools" section (Open WebUI is opt-in, off by default; how to enable from CLI/GUI).
- `admin/docs/faq.md` — an "AI Tools" Q&A with a MAC-EDITION-LINK guard.
- `admin/app/services/docs_service.ts` — only if a dedicated tools doc is added later (not this build).

**Create:**
- `install/macos/man/nomad-tools.1` — groff page modeled on `nomad-backend.1`; must pass `mandoc -Tlint` (no ERROR).
- (tests) extend/add: a `test-tools-*.sh` covering COMPOSE_PROFILES list math (add/remove/dedup/empty) and the preserve-on-upgrade backfill predicate.

**Unchanged but verified:** `dc()` wrapper, `_env_upsert`, `test-host-command-allowlist.sh` (parser unchanged — only its inputs grow), `test-manpages.sh` (bijection holds once `tools)` + `nomad-tools.1` are added).

---

## Data flow

**Enable a tool (CLI):** `nomad tools open-webui on` → `cmd_tools` validates id against the registry → reads current `COMPOSE_PROFILES` → adds `open-webui` (dedup) → `_env_upsert COMPOSE_PROFILES "<list>"` → `dc up -d` (Compose starts `nomad_open-webui`) → prints the URL.

**Disable a tool (CLI):** `nomad tools open-webui off` → remove id from list → `_env_upsert` → `dc stop nomad_open-webui && dc rm -f nomad_open-webui` (explicit, since an unprofiled service isn't auto-removed by `dc up`) → volume kept → prints confirmation.

**Toggle (GUI):** Switch flips → POST `/api/host-commands/tools-open-webui-on` (or `-off`) → controller checks `ALLOWED_COMMANDS` → writes `.pending` marker → bridge LaunchAgent runs `run_cmd` → `nomad tools open-webui on|off` → `.result` written → button reaches `completed` → page reload → `system.services` now shows/hides `nomad_open-webui` → Switch reflects it.

**Fresh install:** installer prompts per tool (default off) → builds `COMPOSE_PROFILES` from accepted ids → written in the `.env` heredoc (nomad:2544) → `dc up` starts only profiled services.

**Existing-install upgrade:** D5 backfill detects a running `nomad_open-webui`, adds `open-webui` to `COMPOSE_PROFILES` before `dc up` → service stays up untouched.

---

## Error handling

- Unknown tool id → non-zero exit, list valid ids; no `.env` write.
- `COMPOSE_PROFILES` list math is set-like: idempotent add (no dupes), safe remove (no-op if absent), trims to empty cleanly.
- Enable when already on / disable when already off → no-op with a clear message (idempotent), still exit 0.
- Bridge command for a tool whose service is mid-state → the on/off handler is idempotent, so a double-fire is safe.
- GUI: while a toggle's bridge command is in flight, the Switch is `disabled` (no double-dispatch); a bridge-not-installed result surfaces the existing amber warning.
- Disable must never delete data (D6); the only volume removal is in `cmd_uninstall`.

---

## Testing

- `bash -n install/macos/nomad` — syntax.
- New `test-tools-*.sh` — COMPOSE_PROFILES list math (add/remove/dedup/empty→nonempty→empty) + the D5 backfill predicate (running container ⇒ backfill; absent ⇒ no-op; already-listed ⇒ no-op).
- `test-host-command-allowlist.sh` — must stay green with the two new paired entries (proves TS const ↔ `run_cmd` sync).
- `test-manpages.sh` — must stay green (`tools)` in dispatcher ↔ `nomad-tools.1`).
- `mandoc -Tlint install/macos/man/nomad-tools.1` — no ERROR.
- `cd admin && npm run typecheck` — clean (new prop, new allow-list entries, Apps-page Switch).
- **Live-on-mini (operator, Chris):** fresh-install-style `nomad tools` default-off; `nomad tools open-webui on` brings up `:3000`, LAN-reachable; `off` stops it + chat history survives a subsequent `on`; `nomad upgrade` on the current (always-on Open WebUI) mini **does not** drop Open WebUI (D5); GUI Switch round-trips through the bridge; `nomad uninstall` removes the `open-webui` volume.

---

## Migration & backward compatibility

- **The existing mini install runs Open WebUI unconditionally.** First `nomad upgrade` after this lands triggers D5 backfill → `COMPOSE_PROFILES=open-webui` written → Open WebUI keeps running. No user action, no data loss.
- The `open-webui` named volume (`name: open-webui`) is preserved across all profile up/down cycles (volumes are lifecycle-independent).
- `_reconcile_open_webui` (the manual→compose migration) is retained and remains a harmless no-op when no manual container exists.

---

## Open questions (for spec review)

1. **Docs placement** — proposal: extend `mac-ai-assistant.md` + an FAQ entry now; spin out a dedicated `mac-ai-tools.md` only when OpenHands lands. (Alternative: create `mac-ai-tools.md` now.)
2. **`nomad check` port handling** — proposal: keep `:3000` in `NOMAD_PORTS` but re-comment it as "conditional (Open WebUI tool)"; the check is warn-only so a false "in use"/absence is cosmetic. (Alternative: make the port list dynamic from enabled tools — slightly more code.)
3. **CLI verb synonyms** — proposal: accept `on|enable` and `off|disable` for ergonomics; `nomad tools` alone = list. (Confirm or trim to just `on|off`.)
