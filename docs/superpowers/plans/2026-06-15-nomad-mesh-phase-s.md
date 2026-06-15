# Phase S — NOMAD Supply Depot + Mesh Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Status:** drafted + audited 2026-06-15. **No implementation until Chris signs off AND answers the mesh-client decision (below).**
> Parent design: `2026-06-15-nomad-mesh.md`. Build patterns: `2026-06-15-nomad-mesh-research.md`.

**Goal:** Forward-port upstream's Supply Depot data model + page from `v1.33.0-rc.1` onto our diverged macOS-arm64 fork, and ship a curated mesh **Web** client as the first Supply Depot app — without regressing our arch-aware update path, oMLX backend split, or pinned-image policy.

**Architecture:** Add Supply Depot's new `services` columns + `custom_library_sources` table via upstream's own migrations at their original timestamps (they sort safely before our `1778*` STL block). Keep the engine in our fork's `SystemController` (preserves arch-awareness + oMLX); add upstream's thin `SupplyDepotController` page-renderer, extended to pass an oMLX props-superset. Replace `settings/apps.tsx` with the top-level `supply-depot.tsx` card page (oMLX special-case preserved), redirect `/settings/apps → /supply-depot`. Seed the mesh Web app as a pinned-tag curated row. Custom-container / auto-update / preflight surface is DEFERRED to Wave 3.

**Tech Stack:** AdonisJS 6 (Lucid migrations + Inertia), React/TypeScript (Inertia pages), Knex (migration DSL), Docker via OrbStack on macOS arm64. Tests: standalone `tests/standalone/*.standalone.ts` run with `node --experimental-strip-types` (NOT Japa — Japa needs MySQL+Redis we don't run in CI; standalone tests need neither).

---

## DECISION (Chris, 2026-06-15) — BOTH mesh Web clients ship Wave 1

Audit-confirmed facts (read directly from the refs):
- **`v1.33.0-rc.1` already ships Meshtastic Web** — `ghcr.io/meshtastic/web` (official image), port 8450→8080, category `networking`, docs in place (`service_seeder.ts:367`). Our "add Meshtastic Web" goal becomes a *forward-port of an existing curated row*, not a build.
- **`feat/supply-depot-meshcore-web` adds a *separate* MeshCore Web** — `ghcr.io/axistem-dev/meshcore-web` (a **third-party** prebuild of Liam Cottle's client for MeshCore, a sibling LoRa protocol), served over HTTPS via a self-signed cert + nginx-SSL preinstall hook. Different app, different protocol, different trust profile.

**Decision: ship BOTH this wave.** Meshtastic Web (Task 4) and MeshCore Web (Task 6) both land in Wave 1, along with the shared `_ensureSelfSignedCert` HTTPS helper (which also DRYs up Vaultwarden's cert path). Chris accepted the `axistem-dev` third-party image; it MUST still be pinned to a digest/version (never `:latest`) per fork policy, and the pinned digest is recorded in the seed commit.

**Resolved by audit (no longer a question):** our service API routes already sit under `.prefix('/api/system')` (`routes.ts:285-290`) — identical to upstream's `/api/system/services/*`. There is **no** route-prefix divergence; the earlier "keep vs rename" question is moot.

---

## Audit corrections applied to the draft

1. **No route-prefix divergence** — ours are already `/api/system/services/*`. Task 2 only adds `GET /supply-depot` + the `/settings/apps` redirect (mirroring upstream `routes.ts:33,51`).
2. **Service model is snake_case** — new columns are `declare is_custom: boolean` etc., matching existing `declare service_name`/`declare container_image` (no camelCase columnName mapping).
3. **Controller DI** — match upstream's real pattern: `@inject()` + `constructor(private systemService: SystemService)` (named import from `#services/system_service`), extended with the oMLX props.
4. **Seed count** — confirm the actual `custom_library_sources` default-mirror count from the migration before hard-coding the Task 1 test assertion.
5. **apps.tsx** — upstream kept theirs orphaned; we delete-after-port (the oMLX logic is preserved in the new page), which is cleaner.

---

## File Structure

**Create:**
- `admin/database/migrations/1772000000001_add_supply_depot_fields_to_services.ts` — +`is_custom`, +`category`.
- `admin/database/migrations/1772000000002_add_user_modified_to_services.ts` — +`is_user_modified`.
- `admin/database/migrations/1772000000003_add_app_auto_update_fields_to_services.ts` — +4 auto-update columns.
- `admin/database/migrations/1775100000001_create_custom_library_sources_table.ts` — new table + default mirrors.
- `admin/database/migrations/1776200000001_add_custom_url_to_services.ts` — +`custom_url`.
- `admin/app/controllers/supply_depot_controller.ts` — thin page-renderer, props-superset.
- `admin/inertia/pages/supply-depot.tsx` — top-level catalog card page (Wave-1 subset).
- `admin/constants/supply_depot_docs.ts` — anchor map + `getSupplyDepotDocLink`.
- `admin/docs/supply-depot-apps.md` — in-app docs page.
- `tests/standalone/supply_depot_schema.standalone.ts` — clean-DB replay schema guard.
- `tests/standalone/supply_depot_props.standalone.ts` — oMLX props-contract.
- `tests/standalone/supply_depot_catalog.standalone.ts` — catalog entry + pinned-tag + docs link.

**Modify:**
- `admin/app/models/service.ts` — +8 snake_case `@column()` declarations.
- `admin/start/routes.ts` — add `GET /supply-depot`; change `/settings/apps` (settings group) to redirect to `/supply-depot`.
- `admin/app/controllers/settings_controller.ts` — re-point/retire `apps()` (oMLX props move to the new controller).
- `admin/inertia/layouts/SettingsLayout.tsx` — replace "Apps" nav entry with "Supply Depot" → `/supply-depot`.
- `admin/database/seeders/service_seeder.ts` — add the mesh Web curated entry (pinned, `source_repo`, `NOMAD_STORAGE_ABS_PATH`-anchored).
- `admin/constants/service_names.ts` — add `MESHTASTIC_WEB` (and `MESHCORE_WEB` in Task 6).
- `admin/inertia/lib/icons.ts` — allowlist the mesh app icon.

**Delete (last, after redirect + page parity verified):**
- `admin/inertia/pages/settings/apps.tsx` — superseded by `supply-depot.tsx`.

---

## Task 1: Schema — port migrations + clean-DB ordering guard

**Files:** create the 5 migrations; modify `admin/app/models/service.ts`; test `tests/standalone/supply_depot_schema.standalone.ts`.

- [ ] **Step 1: Confirm the seeded mirror count.** `git show v1.33.0-rc.1:admin/database/migrations/1775100000001_create_custom_library_sources_table.ts` — count the `is_default:true` rows; use that exact number in the test below (draft estimate: 5).
- [ ] **Step 2: Write the failing schema-replay test** — replay all `admin/database/migrations/*.ts` `up()` in filename order against an in-memory SQLite (better-sqlite3 + Knex), then assert the 8 new `services` columns exist with correct nullability, `custom_library_sources` exists, and the default-mirror count matches Step 1.
- [ ] **Step 3: Run → FAIL** (`node --experimental-strip-types tests/standalone/supply_depot_schema.standalone.ts`) — `services.is_custom missing`.
- [ ] **Step 4: Create the 5 migrations verbatim from `v1.33.0-rc.1`, timestamps preserved.** (Audited columns: `1772000000001` → `is_custom` bool NN default false + `category` string nullable + curated-category backfill; `1772000000002` → `is_user_modified` bool NN default false; `1772000000003` → `auto_update_enabled` bool NN default false, `available_update_first_seen_at` timestamp nullable, `auto_update_consecutive_failures` int NN default 0, `auto_update_disabled_reason` string(255) nullable; `1775100000001` → `custom_library_sources` [id PK, name string(100) NN, base_url string(2048) NN, is_default bool NN default false, created_at/updated_at NN] + seed default mirrors; `1776200000001` → `custom_url` string nullable.) Port each file's body 1:1; mirror an existing `admin/database/migrations/177*` file for the `BaseSchema` boilerplate.
- [ ] **Step 5: Add the 8 columns to the Lucid model** — `admin/app/models/service.ts`, snake_case to match convention: `@column() declare is_custom: boolean`, `declare category: string | null`, `declare is_user_modified: boolean`, `declare auto_update_enabled: boolean`, `@column.dateTime() declare available_update_first_seen_at: DateTime | null`, `declare auto_update_consecutive_failures: number`, `declare auto_update_disabled_reason: string | null`, `declare custom_url: string | null`.
- [ ] **Step 6: Run → PASS.**
- [ ] **Step 7: Verify on a dev-DB copy** — `node ace migration:run` against a copy of the current dev DB: the 5 new migrations report "migrated"; the `1778*` rows are untouched; `migration:status` shows no pending and `services` has the 8 columns. (Existing-DB branch of the ordering hazard.)
- [ ] **Step 8: Commit** (`feat(supply-depot): port upstream services schema + custom_library_sources`).

## Task 2: Controller + page route — props-superset

**Files:** create `supply_depot_controller.ts`; modify `routes.ts`, `settings_controller.ts`; test `supply_depot_props.standalone.ts`.

- [ ] **Step 1: Write the failing props test** — a pure exported `buildSupplyDepotProps(deps)` returns `{ system: { services }, isNativeOllama, aiBackend, aiAssistantVersion }`; assert it carries both the services and the oMLX props.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement the controller** — `@inject()` + `constructor(private systemService: SystemService)` (match upstream's real DI), `index()` calls `buildSupplyDepotProps` with `getServices({ installedOnly: false })` + the oMLX flags our `settings_controller.apps()` currently computes, and `inertia.render('supply-depot', props)`. Copy import-alias style from `settings_controller.ts`.
- [ ] **Step 4: Wire routes** — add top-level `router.get('/supply-depot', [SupplyDepotController, 'index'])`; in the `/settings` group, change `router.get('/apps', [SettingsController, 'apps'])` to `router.on('/apps').redirectToPath('/supply-depot')` (mirrors upstream `routes.ts:51`). Leave the `/api/system/services/*` group untouched — Wave 1 reuses it as-is.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit.**

## Task 3: UI page + nav — supply-depot.tsx with oMLX special-case (Wave-1 subset)

**Files:** create `supply-depot.tsx`; modify `SettingsLayout.tsx`, `icons.ts`; delete `settings/apps.tsx` last.

- [ ] **Step 1: Port the page shell** from upstream `supply-depot.tsx` — props `{ system: { services }, isNativeOllama, aiBackend, aiAssistantVersion? }`, Installed/Available card sections, category filter chips, search, Install via `api.installService`, Open via service link. **Stub out** custom-app modal / preflight / auto-update toggles behind clearly-marked `// Wave 3` comments.
- [ ] **Step 2: Port the oMLX special-case into `AppCard`** — when `service_name === 'nomad_ollama'` and `isNativeOllama`, render the Native(Metal)/Apple-MLX pill + `HostCommandButton` actions and the native version cell exactly as `settings/apps.tsx` does today (omit "Update" on the `omlx` backend). **Parity-critical step.**
- [ ] **Step 3: Nav + icon** — in `SettingsLayout.tsx` replace the "Apps" entry with "Supply Depot" → `/supply-depot` (kept in the Settings sidebar, mirroring upstream); add the mesh icon to `icons.ts` allowlist.
- [ ] **Step 4: Manual render verify** — `/supply-depot` renders cards; the `nomad_ollama` row shows Native/MLX actions (not generic Start/Stop); `/settings/apps` 301s here.
- [ ] **Step 5: `git rm admin/inertia/pages/settings/apps.tsx` + commit.**

## Task 4: Seeder — Meshtastic Web curated entry (pinned, fork-policy compliant)

**Files:** modify `service_names.ts`, `service_seeder.ts`; test `supply_depot_catalog.standalone.ts`.

- [ ] **Step 1: Write the failing catalog test** — `ServiceSeeder.DEFAULT_SERVICES` has a `nomad_meshtastic_web` row: `is_custom:false`, `category:'networking'`, image pinned (regex rejects `:latest`), `source_repo` set, port binding `8080/tcp → HostPort 8450`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Resolve the pinned tag** — `docker buildx imagetools inspect ghcr.io/meshtastic/web:latest` to capture the digest + concrete arm64 version tag (fork policy: no `:latest`).
- [ ] **Step 4: Add the constant + seed entry** — `MESHTASTIC_WEB: 'nomad_meshtastic_web'`; the seed row with friendly_name 'Meshtastic Web', powered_by 'Meshtastic', pinned image, `source_repo`, `category:'networking'`, mesh icon, `container_config` binding `8080→8450`, a `display_order` consistent with existing values. Keep `run()` additive-only.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Install smoke-test on arm64/OrbStack** — seed, open `/supply-depot`, Install Meshtastic Web, confirm arm64 manifest pulls + the Open link serves the client.
- [ ] **Step 7: Commit.**

## Task 5: Docs wiring — anchor map + docs page

**Files:** create `supply_depot_docs.ts`, `supply-depot-apps.md`; extend the catalog test.

- [ ] **Step 1: Failing doc-link test** — `getSupplyDepotDocLink('nomad_meshtastic_web') === '/docs/supply-depot-apps#meshtastic-web'`; unknown → `null`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the anchor map + link builder + a `## Meshtastic Web {% #meshtastic-web %}` docs section.
- [ ] **Step 4: Run → PASS. Step 5: Commit.**

## Task 6 (Wave 1, confirmed): MeshCore Web + `_ensureSelfSignedCert`

Port from `crosstalk/feat/supply-depot-meshcore-web`: extract `_ensureSelfSignedCert(certDir, commonName)` in `docker_service.ts` (10-yr idempotent self-signed pair), refactor `_runPreinstallActions__Vaultwarden` to use it (DRY, verify Vaultwarden still gets its cert), add `_runPreinstallActions__MeshCoreWeb` (cert + nginx-SSL conf into `storage/meshcore-web`), add `MESHCORE_WEB` constant + seed entry (**pin** `ghcr.io/axistem-dev/meshcore-web` to a digest, never `:latest`, 443→8500, two ro binds anchored to `NOMAD_STORAGE_ABS_PATH`), docs section. TDD + per-file commits. The Vaultwarden cert-path refactor must keep Vaultwarden's existing behavior identical (verify it still provisions its cert before shipping).

## Task 7 (Wave 2 — separate plan + GitHub issue): curated catalog batch

Forward-port the clean-fit curated apps, each pinned off `:latest` to a verified arm64 digest, `source_repo` populated, with constant + docs anchor + catalog test:
- **Adopt:** Vaultwarden (security), Stirling-PDF (productivity), IT-Tools (utility), Excalidraw (productivity), Calibre-Web (verify the LSIO arm64 tag — heavier native stack).
- **Grocy (food module, NEW — not upstream-curated):** bundle as a curated food app. This is the canonical food/pantry system per [decision](#); pin a verified arm64 tag. Ties to the federated-readiness work item below.
- **Skip:** Homebox (duplicates our native inventory), MeshtasticD (radio-less on Mac, wrong mechanism — our Phase 2 host bridge is the real path).
- **Defer / verify-then-ship:** FileBrowser (ships root + hardcoded default credential — adopt only with the credential overridden), Jellyfin (no VAAPI on OrbStack; 2 GB/20 GB footprint).

File as a `backlog`+`enhancement` issue with per-app risk notes.

## Work item (separate plan + GitHub issue): Grocy federated readiness

Decided 2026-06-15: Grocy owns food; our `inventory_items` cedes food; our **Supply Readiness** reads food/calorie stock from Grocy's REST API so days-of-supply is one unified number across food + water + power + medical + comms, degrading gracefully if Grocy is absent. Depends on Grocy running as a Supply Depot app (Task 7). Needs its own design pass against our `RESOURCE_TYPES`/days-of-supply model + Grocy's calorie/stock API. See memory `grocy-preparedness-architecture`. File as its own plan + issue; do NOT bolt onto Phase S.

## Task 8 (Wave 3 — separate plan + GitHub issue): custom-container + auto-update surface

Graft upstream's `SystemController` custom-app methods + VineJS validators + `evaluateCustomApp` guard, thread `hostArch` through auto-update lookups, un-stub the custom-app UI. **Security prerequisite (file issue NOW):** the `/api/system/services/*` group has no auth middleware — decide the auth posture before exposing `createCustomApp` (runs against the Docker socket).

---

## CI / build wiring

Add the three standalone tests to the existing `tests/standalone/*.standalone.ts` runner (`node --experimental-strip-types`). No Japa specs (needs MySQL+Redis); the schema test uses in-memory SQLite, the rest are pure-logic — all hermetic. Confirm the glob picks them up and they pass in CI before promoting.

## Verification gate (before "done")

- [ ] All standalone tests green, 0 failures.
- [ ] Clean-DB replay green AND `migration:run` clean on a dev-DB copy.
- [ ] `/supply-depot` renders; `/settings/apps` 301s to it; the `nomad_ollama` row shows Native/MLX actions (oMLX parity).
- [ ] Meshtastic Web installs, pulls an arm64 manifest in OrbStack, Open link serves the client.
- [ ] No `:latest` introduced; `source_repo` populated on the new row.
- [ ] Every PRESERVE item intact (arch-aware updates, oMLX split, pinned images, Qdrant telemetry-off, STL/drug independence).

## Backlog issues to file (per CLAUDE.md backlog→issues rule)

1. **Wave 2** — curated-catalog forward-port batch with per-app arm64 risk notes (`backlog`,`enhancement`).
2. **Wave 3 security** — `/api/system/services/*` has no auth middleware; decide posture before custom-container creation lands (`backlog`,`enhancement`).
