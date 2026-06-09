# Preparedness Audit Migration Batch — 0.2.715 Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the migration-bearing audit follow-ups from the 2026-06-07 canonical+cascade audit (GitHub #14) on the inventory/scenario/readiness domain, as patch **0.2.715** (stay in 0.2.7xx).

**Architecture:** AdonisJS v6 + Lucid (MySQL) backend, Inertia React frontend. The Preparedness suite uses **varchar columns validated at the Vine layer, NOT native MySQL enums** ("enum enforced at the validator layer; varchar so it grows freely") — follow that pattern for `kind`. New migrations live in `admin/database/migrations/` named `<unix_ms>_<desc>.ts`; use timestamps `1778700000001`–`1778700000007` (above the highest existing `1778600000007`). Migrations run on the mini via `node ace migration:run` during `nomad upgrade` — they CANNOT be run locally (no MySQL), so correctness is proven by tsc + review, not execution.

**Tech Stack:** Lucid schema builder, Vine validators, Inertia React + Tailwind (desert-* theme).

**Version:** ships as **0.2.715** (root `package.json` `version` → `0.2.715-macos`).

---

## SCOPE SPLIT (important)

**IN 0.2.715 (this plan):** items 1–7 below + item 8a (the `ingested_at` DB-default migration ONLY).

**DEFERRED to 0.2.716** (do NOT touch in this batch): the drug **stale-row purge** logic + KV `drugReference.ingestRunStartedAt` marker. Reason: it modifies `admin/app/jobs/ingest_drug_data_job.ts`, the file just fixed for the worker crash in 0.2.714, which is pending live verification on the mini. Do not stack an ingest-job change on unverified ingest code. **`ingest_drug_data_job.ts` must NOT be edited in 0.2.715.**

---

## Decisions locked (GitHub #14 + board, 2026-06-07)

- `kind` discriminator **decided: ADD** — `varchar(16) not null default 'consumable'`, values `consumable` | `gear`, validated at Vine layer. Backfill + form field-branching + list filter.
- `never_expires` **decided: MIGRATION** — `tinyint(1) not null default 0`, form toggle, "No expiry" display, excluded from expiry warnings.
- Preparedness columns are varchar+Vine, not native enums.

---

## Gates (run after implementation, report results)

- Backend types: `cd admin && npm run typecheck` → expect 0 errors.
- Inertia types: `cd admin && npx tsc -p inertia/tsconfig.json --noEmit` → baseline is **10** pre-existing errors; expect NO NEW errors (i.e. still 10, and none in files this batch touched).
- Full build (what CI runs): `cd admin && node ace build` → expect success.
- Do NOT run `node ace migration:run` (no local MySQL). Do NOT run the Japa test suite (can't boot without DB/Redis).
- Do NOT `git commit` — leave all changes in the working tree for orchestrator review.

---

## Task 1: `kind` discriminator on inventory items (MIGRATION)

**Files:**
- Create: `admin/database/migrations/1778700000001_add_kind_to_inventory_items.ts`
- Modify: `admin/app/models/inventory_item.ts`, `admin/app/services/inventory_service.ts`, `admin/app/validators/inventory.ts`, `admin/types/inventory.ts`, `admin/app/controllers/inventory_controller.ts`, `admin/inertia/pages/inventory/show.tsx`, `admin/inertia/components/inventory/InventoryFilters.tsx`, `admin/inertia/components/inventory/InventoryCard.tsx`, `admin/inertia/pages/readiness/index.tsx` (InventoryTab filter wiring)

- [ ] **Migration** — ADD `kind` varchar(16) not null default 'consumable', backfill gear, index it:
```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    // varchar (not native enum) — kind enforced at the Vine validator layer so it
    // grows freely, matching the rest of the Preparedness suite.
    this.schema.alterTable(this.tableName, (table) => {
      table.string('kind', 16).notNullable().defaultTo('consumable')
    })
    // Backfill: an item with a gear condition and no consumable signals is gear.
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .whereNotNull('condition')
        .whereNull('expiry_date')
        .whereNull('restock_threshold')
        .whereNull('resource_type')
        .update({ kind: 'gear' })
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.index('kind', 'idx_inventory_kind')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex('kind', 'idx_inventory_kind')
      table.dropColumn('kind')
    })
  }
}
```

- [ ] **Model** — add after `category` column in `inventory_item.ts`:
```ts
@column()
declare kind: InventoryKind
```
Add the type. In `admin/types/inventory.ts` (and re-export path the model uses) define:
```ts
export type InventoryKind = 'consumable' | 'gear'
export const INVENTORY_KINDS: InventoryKind[] = ['consumable', 'gear']
```
The model currently imports its column union types (e.g. `InventoryCategory`, `InventoryCondition`) — add `InventoryKind` to that same import source and ensure the model file references it. (Check where `InventoryCategory` is declared — mirror that location for `InventoryKind`.)

- [ ] **Validator** (`admin/app/validators/inventory.ts`) — in `createInventoryItemValidator` and `updateInventoryItemValidator` add:
```ts
kind: vine.enum(['consumable', 'gear']).optional(),
```
(create may default at the service; keep optional and default to 'consumable' in the service when undefined.) In `listInventoryItemsValidator` add:
```ts
kind: vine.enum(['consumable', 'gear']).optional(),
```

- [ ] **Service** (`admin/app/services/inventory_service.ts`):
  - `CreateInventoryData`: add `kind?: InventoryKind`.
  - `create()`: `item.kind = data.kind ?? 'consumable'`.
  - `update()`: `if (data.kind !== undefined) item.kind = data.kind`.
  - `list()` mapper (InventoryItemSlim): add `kind: row.kind`.
  - `list()` query: if `filters.kind` present → `query.where('kind', filters.kind)`.

- [ ] **Types** (`admin/types/inventory.ts`): add `kind: InventoryKind` to `InventoryItemSlim` and `InventoryItemDetail`; add `kind?: InventoryKind` to `InventoryListFilters`.

- [ ] **Controller** (`admin/app/controllers/inventory_controller.ts`): `show()` detail mapper add `kind: item.kind`. `enumsForUi()` add `kinds: INVENTORY_KINDS`.

- [ ] **Form** (`admin/inertia/pages/inventory/show.tsx`):
  - form state: add `kind: item?.kind ?? 'consumable'`.
  - `buildPayload()`: add `kind: form.kind`.
  - Add a `kind` select in the Basics SectionCard (Consumable / Gear), wired to `set('kind', ...)`.
  - **Field-branching:** wrap `condition` so it renders only when `form.kind === 'gear'`; wrap `expiry_date` + `never_expires` toggle + `restock_threshold` + `unit` so they render only when `form.kind === 'consumable'`. Keep name, category, quantity, location, notes, and the resource bridge (resource_type / resource_contribution) visible for BOTH kinds (gear such as a generator still contributes power).

- [ ] **Filter** (`InventoryFilters.tsx`): add a Kind select (All / Consumable / Gear) bound to the `kind` filter.

- [ ] **Card** (`InventoryCard.tsx`): show a small kind badge (e.g. "Gear" / "Consumable"); when gear, prefer showing `condition` and suppress expiry/restock-only chrome.

- [ ] **Verify:** backend typecheck 0; inertia tsc no new errors; `node ace build` success.

---

## Task 2: `linked_name_snapshot` on scenario plan steps (MIGRATION)

**Files:**
- Create: `admin/database/migrations/1778700000002_add_linked_name_snapshot_to_scenario_plan_steps.ts`
- Modify: `admin/app/models/scenario_plan_step.ts`, `admin/app/services/scenario_plan_service.ts`, `admin/app/controllers/scenario_plan_controller.ts`, `admin/types/scenarios.ts`, `admin/inertia/pages/plans/show.tsx`

- [ ] **Migration**:
```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'scenario_plan_steps'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Snapshot of the linked target's display name at link time, so a step whose
      // FK was SET NULL'd on target deletion shows "was: <name>" instead of blanking.
      table.string('linked_name_snapshot', 255).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('linked_name_snapshot')
    })
  }
}
```

- [ ] **Model** (`scenario_plan_step.ts`): add `@column() declare linked_name_snapshot: string | null`.

- [ ] **Service** (`scenario_plan_service.ts`): in `addStep()` and `updateStep()`, when `inventory_item_id` is set, look up the item name and set `step.linked_name_snapshot`; else if `stl_file_id` is set, look up that name; else leave/clear. Use the existing model imports (`InventoryItem`, `StlFile`). On update where the link is cleared (set to null), set snapshot to null. Keep it a single awaited query per write (no perf concern — one step at a time).

- [ ] **Controller** (`scenario_plan_controller.ts:~62`): add `linked_name_snapshot: step.linked_name_snapshot` to the step DTO mapper.

- [ ] **Types** (`admin/types/scenarios.ts`): add `linked_name_snapshot: string | null` to the step DTO type.

- [ ] **Page** (`plans/show.tsx`, StepRow ~270–374): when `link.kind === 'none'` but `step.linked_name_snapshot` is present, render a muted "was: {snapshot}" line (e.g. `text-xs text-desert-sand/60`) so a deleted target reads as a former link rather than vanishing.

- [ ] **Verify:** gates green.

---

## Task 3: `condition` wire-in to list DTO + filter (NO migration)

**Files:** `admin/types/inventory.ts`, `admin/app/services/inventory_service.ts`, `admin/app/validators/inventory.ts`, `admin/inertia/components/inventory/InventoryFilters.tsx`, `admin/inertia/components/inventory/InventoryCard.tsx`

- [ ] Add `condition: InventoryCondition | null` to `InventoryItemSlim`.
- [ ] Service `list()` mapper: add `condition: row.condition`.
- [ ] `InventoryListFilters`: add `condition?: InventoryCondition`.
- [ ] `listInventoryItemsValidator`: add `condition: vine.enum(<the existing conditions>).optional()` (reuse the same condition values the create validator uses).
- [ ] Service `list()` query: if `filters.condition` present → `query.where('condition', filters.condition)`.
- [ ] `InventoryFilters.tsx`: add a Condition select (only meaningful for gear, but harmless globally; All + each condition).
- [ ] `InventoryCard.tsx`: surface `condition` on the card for gear items.
- [ ] **Verify:** gates green.

---

## Task 4: rename `scenario_plan_steps.created_at` → `added_at` (MIGRATION)

**Files:**
- Create: `admin/database/migrations/1778700000003_rename_created_at_to_added_at_scenario_plan_steps.ts`
- Modify: `admin/app/models/scenario_plan_step.ts`

- [ ] **Migration** — use a raw rename (MySQL 8 supports RENAME COLUMN; matches Lucid via rawQuery for safety):
```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'scenario_plan_steps'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('created_at', 'added_at')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('added_at', 'created_at')
    })
  }
}
```

- [ ] **Model** (`scenario_plan_step.ts`): change
```ts
@column.dateTime({ autoCreate: true })
declare created_at: DateTime
```
to
```ts
@column.dateTime({ autoCreate: true, columnName: 'added_at' })
declare added_at: DateTime
```
(matches the parent `ScenarioPlan` model). `created_at` is not exposed in any DTO/page, so no further changes — but GREP `created_at` in scenario step service/controller to be sure; fix any reference.

- [ ] **Verify:** gates green.

---

## Task 5: `restock_threshold` index (MIGRATION)

**Files:** Create `admin/database/migrations/1778700000004_add_restock_threshold_index.ts`

- [ ] **Migration**:
```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index('restock_threshold', 'idx_inventory_restock')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex('restock_threshold', 'idx_inventory_restock')
    })
  }
}
```
- [ ] **Verify:** typecheck/build green (no code change).

---

## Task 6: dedupe `contributesToReadiness` (NO migration)

**Files:** Create `admin/util/inventory.ts`; Modify `admin/app/models/inventory_item.ts`, `admin/inertia/components/inventory/InventoryCard.tsx`

- [ ] **Util** — single source of truth (pure, importable from both backend and inertia):
```ts
import type { ResourceType } from '../types/inventory.js'

/** Whether an inventory item contributes a positive amount to readiness. */
export function contributesToReadiness(row: {
  resource_type: ResourceType | null
  resource_contribution: number | null
}): boolean {
  return (
    row.resource_type !== null &&
    row.resource_contribution !== null &&
    row.resource_contribution > 0
  )
}
```
(Confirm the import path/extension convention the repo uses for `admin/util/*` — match the existing util files e.g. `admin/util/drug_labels.ts` for import style.)

- [ ] **Model** (`inventory_item.ts`): replace the body of the static `contributesToReadiness` with a call to the util (keep the static method as a thin wrapper so existing callers don't change), or import + delegate.
- [ ] **Card** (`InventoryCard.tsx`): replace the inline boolean (lines ~30–33) with `const countsTowardReadiness = contributesToReadiness(item)` importing the util.
- [ ] **Verify:** gates green; confirm the util import works from BOTH `app/` (backend tsc) and `inertia/` (client tsc) — if the path/alias differs, place the util where both tsconfigs resolve it (mirror how `InventoryCard` already imports shared types from `admin/types/inventory.ts`).

---

## Task 7: `never_expires` flag (MIGRATION)

**Files:**
- Create: `admin/database/migrations/1778700000005_add_never_expires_to_inventory_items.ts`
- Modify: `admin/app/models/inventory_item.ts`, `admin/app/services/inventory_service.ts`, `admin/app/validators/inventory.ts`, `admin/types/inventory.ts`, `admin/app/controllers/inventory_controller.ts`, `admin/inertia/pages/inventory/show.tsx`, `admin/inertia/components/inventory/InventoryCard.tsx`

- [ ] **Migration**:
```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('never_expires').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('never_expires')
    })
  }
}
```

- [ ] **Model**: add `@column() declare never_expires: boolean`.
- [ ] **Types**: add `never_expires: boolean` to `InventoryItemSlim` and `InventoryItemDetail`.
- [ ] **Validator**: add `never_expires: vine.boolean().optional()` to create + update validators.
- [ ] **Service**: `create()` → `item.never_expires = data.never_expires ?? false`; `update()` → patch if present; `list()` mapper → `never_expires: row.never_expires`.
- [ ] **Service expiry logic** — in `expiringBefore()` add `.where('never_expires', false)`; in the `expiring_within_days` list filter add `.where('never_expires', false)`. (Never-expiring items must not appear in expiry warnings.)
- [ ] **Controller**: detail mapper add `never_expires: item.never_expires`.
- [ ] **Form** (`inventory/show.tsx`, consumable branch next to expiry_date): add a checkbox "This item never expires"; when checked, clear `expiry_date` ('') and disable the date input. form state add `never_expires: item?.never_expires ?? false`; `buildPayload()` add `never_expires: form.never_expires` and force `expiry_date: form.never_expires ? null : (...)`.
- [ ] **Card/Detail**: when `never_expires` is true, render "No expiry" instead of an expiry date / "Expiring soon" badge (guard the `expiringSoon` computation: never show the badge when never_expires).
- [ ] **Verify:** gates green.

---

## Task 8a: `ingested_at` DB default on drug_labels (MIGRATION ONLY)

**Files:** Create `admin/database/migrations/1778700000006_add_ingested_at_default_drug_labels.ts`

> NOTE: this is migration-only. Do NOT edit `ingest_drug_data_job.ts` (the purge logic + KV marker are deferred to 0.2.716). This migration just makes raw SQL inserts defensive — the ORM already sets `ingested_at` via autoCreate/autoUpdate.

- [ ] **Migration** — MySQL MODIFY via rawQuery (matches the FULLTEXT raw-SQL pattern in the create migration):
```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'drug_labels'

  async up() {
    this.defer(async (db) => {
      await db.rawQuery(
        'ALTER TABLE drug_labels MODIFY COLUMN ingested_at timestamp NOT NULL ' +
          'DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.rawQuery('ALTER TABLE drug_labels MODIFY COLUMN ingested_at timestamp NOT NULL')
    })
  }
}
```
(If `this.defer((db) => ...)` is not the established raw pattern in this repo, match whatever the create migration used for its raw FULLTEXT index — use the same `db`/`this.db`/`this.schema.raw` accessor.)

- [ ] **Verify:** typecheck/build green.

---

## Task 9: version bump + final gate

- [ ] Bump root `package.json` `version` → `0.2.715-macos`.
- [ ] Re-run all three gates clean.
- [ ] Report: per-task gate results, the full list of files changed, and any deviation from this plan.
- [ ] Do NOT commit — orchestrator (Opus) reviews the diff, then commits + bumps + pushes + verifies CI.

---

## Self-review checklist (run before reporting)

1. Every new column added to: migration + model + (Slim and/or Detail) type + service create/update/list-mapper + validator + form + display. No half-wired column.
2. `kind` field-branching: gear hides expiry/restock/unit/never_expires; consumable hides condition; resource bridge shown for both.
3. `never_expires` excluded from BOTH expiry queries (expiringBefore + expiring_within_days filter).
4. `contributesToReadiness` util resolves from both backend and inertia tsconfigs.
5. Migration timestamps strictly increasing and > 1778600000007.
6. `ingest_drug_data_job.ts` NOT touched.
7. Inertia tsc introduces NO new errors beyond the baseline 10.
