---
type: design-spec
status: draft-for-review
date: 2026-06-06
project: project-nomad (macOS / Apple-Silicon fork)
feature: Self-Reliance Suite — Inventory, Readiness Calculator, Scenario Plans
decided_by: Chris (2026-06-06) — scope LOCKED, three patch releases on the 0.2.x line
phases:
  - { phase: 1, name: Inventory,            version: 0.2.61 }
  - { phase: 2, name: Readiness Calculator, version: 0.2.62 }
  - { phase: 3, name: Scenario Plans,       version: 0.2.63 }
template: admin/ "Workshop / Offline STL Library" feature
tags: [nomad, macos, self-reliance, inventory, readiness, scenarios, adonis, inertia, lucid]
---

# Self-Reliance Suite

Three subsystems for the NOMAD offline self-reliance / knowledge server, each
modeled on the existing **Workshop** feature. Inventory is a manual catalog of
what you have; the Readiness Calculator reads that catalog and tells you how
many days you can sustain; Scenario Plans are editable checklists that cross-link
to inventory items, STL files, and ZIM articles.

> **Scope is LOCKED** (Chris, 2026-06-06). This spec transcribes those decisions
> into an implementation-ready form. It does not add features, propose
> alternatives, or widen scope. Where this document poses an "open question" it
> is a confirmation-at-review item, not an invitation to expand the design.

---

## 1. Overview & goals

| Goal | What it means here |
|---|---|
| Know what you have | A unified, manually-curated inventory catalog (not a filesystem scan). |
| Know how long it lasts | A pure calculator that turns inventory into "days of water / food / power" against a household profile. |
| Know what to do | Editable per-scenario checklists that point at the exact item / print / article you need. |
| Match the house style | Every piece mirrors the Workshop feature chain so the codebase stays uniform and reviewable. |
| Ship safely | Pure-helper unit tests + `tsc --noEmit` are the gates; the Japa suite cannot boot locally (no DB/Redis). |

Non-goals (explicitly out of scope, YAGNI): barcode scanning, photos/attachments
on items, multi-location warehouse logic, push notifications/alerts, shopping
lists, external API price lookups, sync between NOMADs, audit history of stock
changes. None of these ship in 0.2.61–0.2.63.

---

## 2. Versioning & phasing

Each phase is its own implementation plan, commit series, and patch release on
the existing `0.2.x` line. The version source of truth is the **root**
`package.json` (`/Users/chrisweis/Developer/project-nomad-macos-arm64/package.json`,
currently `0.2.5-macos`); the admin UI reads its version from there.

| Phase | Feature | `package.json` version | Git tag |
|---|---|---|---|
| 1 | Inventory | `0.2.61-macos` | `v0.2.61-macos+2026.MM.DD` |
| 2 | Readiness Calculator | `0.2.62-macos` | `v0.2.62-macos+2026.MM.DD` |
| 3 | Scenario Plans | `0.2.63-macos` | `v0.2.63-macos+2026.MM.DD` |

- Patch `Z` runs `61 → 62 → 63`. Tag scheme `vX.Y.Z-macos+YYYY.MM.DD` (date is
  the release date).
- Each release is deployed via `nomad upgrade` (the existing update path).
- Phases are sequential: Phase 2 depends on the `inventory_items` table from
  Phase 1; Phase 3 cross-links to `inventory_items` (Phase 1) and the existing
  `stl_files` table.

---

## 3. Shared architecture — the Workshop template chain

Every phase follows the same dependency-ordered chain, lifted directly from the
Workshop feature. The cited files are the **template to copy patterns from** (do
not edit them; create new analogues):

| Layer | Workshop template (read these) | Notes the analogue must preserve |
|---|---|---|
| Shared types/enums | `admin/types/stl_library.ts` | `as const` enum arrays + derived union types; a `*_LABELS` record; slim vs detail DTO interfaces; filter interface. |
| Lucid model | `admin/app/models/stl_file.ts` | `SnakeCaseNamingStrategy`; `@column` declares; nullable columns as `T \| null`; defensive JSON `prepare`/`consume` for any array/object column; a static `isMetadataComplete()`-style predicate when useful; `@column.dateTime({ autoCreate / autoUpdate })`. |
| Migration | `admin/database/migrations/1778459218121_create_stl_files_table.ts` | Enums stored as **varchars, not native DB enums** (grow without `ALTER TABLE`; validation enforced at the Vine layer); explicit named indexes matching the list-page filters; `up()`/`down()`. |
| Service | `admin/app/services/stl_scanner_service.ts` | Class with the data-access + business logic; returns plain result objects; logs via `@adonisjs/core/services/logger`. (Our services are CRUD/aggregation, **no filesystem scanner** — Inventory is manual records.) |
| Validator (Vine) | `admin/app/validators/stl_library.ts` | `vine.compile`; enums via `vine.enum(CONST_ARRAY)`; create vs update validators; update fields `.optional()`; lengths/ranges capped; `.nullable().optional()` for clearable fields. |
| Controller | `admin/app/controllers/workshop_controller.ts` | `index` renders Inertia list, `show` renders detail/edit, `store`/`update`/`destroy` are JSON mutations; `request.validateUsing(...)`; integer-id guards; `isLocalNetworkRequest(request)` surfaced to the page; never leak exceptions to the UI. |
| Routes | `admin/start/routes.ts` (lines 35–53) | Page GETs unguarded; a `/api/<feature>` group for mutations; **mutating routes carry `.use(middleware.localNetworkOnly())`**; a non-gated "permission probe" GET so the UI can render either the editable form or a LAN-only notice. |
| Inertia list page | `admin/inertia/pages/workshop/index.tsx` | `AppLayout`; `<Head>`; card grid + filter sidebar + empty/unavailable states; `router.get`/`router.reload` for partial visits. |
| Inertia detail page | `admin/inertia/pages/workshop/show.tsx` | Detail + edit form; `fetch` to the JSON API with `X-Requested-With: XMLHttpRequest`; toast on save; confirm-before-delete. |
| Card component | `admin/inertia/components/workshop/StlCard.tsx` | One grid tile; badges; graceful null formatting helpers. |
| Filters component | `admin/inertia/components/workshop/WorkshopFilters.tsx` | URL-driven filter rail; strips empty params; partial Inertia visits. |
| Home tile | `admin/inertia/pages/home.tsx` (`WORKSHOP_ITEM`, lines 56–65) | A `displayOrder`-sorted dashboard tile; Tabler icon; `installed: true`; `to: '/<feature>'`. |
| KV settings/flags | `admin/app/models/kv_store.ts` + `admin/types/kv_store.ts` | `KVStore.getValue/setValue/clearValue`; new keys added to `KV_STORE_SCHEMA` with a `'boolean'`/`'string'` tag. |
| LAN gating | `admin/app/middleware/local_network_only_middleware.ts` (registered `localNetworkOnly` in `admin/start/kernel.ts` line 49) | Reuse the named middleware as-is; call `isLocalNetworkRequest()` in controllers for the UI hint. |
| Pure-helper + unit test | `admin/util/embed_jobs.ts` + `admin/tests/unit/embed_jobs.spec.ts` | Extract the logic that matters (conversions, predicates, the calculator) into pure functions in `admin/util/*.ts`; unit-test them with `@japa/runner` `test.group` + `assert`. |

### Data root convention

File content (Workshop STLs, ZIM, maps) lives under
`${NOMAD_DATA_ROOT}/storage/<feature>/`. **The Self-Reliance Suite stores no file
content** — Inventory items, household config, and scenario plans are pure DB
rows (+ a couple of KV keys). There is therefore **no drive-disconnected
"unavailable" panel** in this suite (unlike Workshop, whose library lives on the
removable drive). If a future item ever references an on-disk artifact, it does
so by foreign key to `stl_files` (already drive-aware), not by storing its own
files.

### Files to create per phase

```
PHASE 1 — Inventory (v0.2.61)
  admin/types/inventory.ts
  admin/app/models/inventory_item.ts
  admin/database/migrations/<ts>_create_inventory_items_table.ts
  admin/app/services/inventory_service.ts
  admin/app/validators/inventory.ts
  admin/app/controllers/inventory_controller.ts
  admin/util/units.ts                         (PURE — unit tests)
  admin/tests/unit/units.spec.ts
  admin/inertia/pages/inventory/index.tsx
  admin/inertia/pages/inventory/show.tsx
  admin/inertia/components/inventory/InventoryCard.tsx
  admin/inertia/components/inventory/InventoryFilters.tsx
  (edit) admin/start/routes.ts                — /inventory + /api/inventory/*
  (edit) admin/start/kernel.ts                — no change (reuse localNetworkOnly)
  (edit) admin/types/kv_store.ts              — add inventory.measurementSystem key
  (edit) admin/inertia/pages/home.tsx         — INVENTORY_ITEM tile

PHASE 2 — Readiness Calculator (v0.2.62)
  admin/types/readiness.ts
  admin/util/readiness.ts                     (PURE — unit tests, highest value)
  admin/tests/unit/readiness.spec.ts
  admin/app/services/readiness_service.ts     (reads InventoryService + config)
  admin/app/validators/readiness.ts           (household-config validator)
  admin/app/controllers/readiness_controller.ts
  admin/inertia/pages/readiness/index.tsx
  admin/inertia/components/readiness/ResourceCard.tsx
  (edit) admin/start/routes.ts                — /readiness + /api/readiness/config
  (edit) admin/types/kv_store.ts              — add readiness.* config keys
  (edit) admin/inertia/pages/home.tsx         — READINESS_ITEM tile

PHASE 3 — Scenario Plans (v0.2.63)
  admin/types/scenarios.ts
  admin/app/models/scenario_plan.ts
  admin/app/models/scenario_plan_step.ts      (see §6 model-vs-JSON decision)
  admin/database/migrations/<ts>_create_scenario_plans_table.ts
  admin/database/migrations/<ts>_create_scenario_plan_steps_table.ts
  admin/database/seeders/scenario_plan_seeder.ts   (starter templates)
  admin/app/services/scenario_service.ts
  admin/util/scenario_links.ts                (PURE — link-resolution, unit tests)
  admin/tests/unit/scenario_links.spec.ts
  admin/app/validators/scenarios.ts
  admin/app/controllers/scenario_controller.ts
  admin/inertia/pages/scenarios/index.tsx
  admin/inertia/pages/scenarios/show.tsx
  admin/inertia/components/scenarios/ScenarioStep.tsx
  (edit) admin/start/routes.ts                — /scenarios + /api/scenarios/*
  (edit) admin/inertia/pages/home.tsx         — SCENARIOS_ITEM tile
```

Migration filenames use the existing monotonic-timestamp prefix convention (e.g.
`1778600000001_create_inventory_items_table.ts`) so they order after
`1778459218121_create_stl_files_table.ts`.

---

## 4. Phase 1 — Inventory (v0.2.61)

A **unified item catalog** — one model covers consumables, gear, and
resource-mapped supplies. Items are created/edited by hand (no scanner). A nullable
"resource-mapping bridge" lets selected items feed the Phase 2 calculator.

### 4.1 Data model — `inventory_items` table

`InventoryItem` model, table `inventory_items`. Enums stored as **varchars**
(validate at the Vine layer), mirroring `stl_files`.

| Column | Type (migration) | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `bigIncrements` (primary) | no | — | |
| `name` | `string(255)` | no | — | Required; the human label. |
| `category` | `string(32)` | no | `'other'` | Enum: `food, water, meds, fuel, batteries, tools, comms, shelter, other`. |
| `quantity` | `decimal(12,3)` | no | `0` | How many `unit`s on hand. Decimal so "2.5 gal" works. |
| `unit` | `string(32)` | no | `''` | Free text: `gal`, `cans`, `rounds`, `boxes`, etc. Display only. |
| `location` | `string(255)` | yes | `null` | Where it's stored ("garage shelf B"). |
| `notes` | `text` | yes | `null` | Freeform. |
| `expiry_date` | `date` | yes | `null` | Consumables only. Drives "expiring soon" + Phase 2 expiry warnings. |
| `restock_threshold` | `decimal(12,3)` | yes | `null` | Flag low stock when `quantity <= restock_threshold`. |
| `condition` | `string(16)` | yes | `null` | Gear only. Enum: `new, good, fair, poor`. |
| `resource_type` | `string(16)` | yes | `null` | Bridge to calculator. Enum: `water, food, power` (or `null`/`none` = excluded). |
| `resource_contribution` | `decimal(14,3)` | yes | `null` | Amount this *whole row* contributes, in the **base unit** for its `resource_type` (see §4.3). `null` when `resource_type` is null. |
| `added_at` | `timestamp` | no | — | `autoCreate`. |
| `updated_at` | `timestamp` | no | — | `autoCreate` + `autoUpdate`. |

**Indexes** (named, matching the list filters and the calculator/low-stock reads):

| Index name | Columns | Serves |
|---|---|---|
| `idx_inventory_category` | `category` | Category filter. |
| `idx_inventory_expiry` | `expiry_date` | "Expiring soon" sort/filter + Phase 2 expiry math. |
| `idx_inventory_resource_type` | `resource_type` | Phase 2 per-resource aggregation. |
| `idx_inventory_resource_type_expiry` | `resource_type, expiry_date` | Phase 2 "resource X expiring before horizon". |
| `idx_inventory_location` | `location` | Location filter. |

Low-stock is a row-level predicate (`quantity <= restock_threshold`), not a stored
column — it is computed in SQL (`whereColumn('quantity', '<=', 'restock_threshold')`)
and in a pure predicate helper (§4.5). No dedicated index beyond `category`;
acceptable for a household-scale table (hundreds of rows, not millions).

**Model helper** (mirrors `StlFile.isMetadataComplete`): a static
`InventoryItem.contributesToReadiness(row)` returning
`row.resource_type !== null && row.resource_contribution !== null && row.resource_contribution > 0`.
Used by the service when summing for the calculator and by the UI to badge items
as "counts toward readiness."

### 4.2 Types — `admin/types/inventory.ts`

Mirror `stl_library.ts`: `as const` arrays + union types for
`INVENTORY_CATEGORIES`, `ITEM_CONDITIONS`, `RESOURCE_TYPES`; a `CATEGORY_LABELS`
record; `InventoryItemSlim` (grid) and `InventoryItemDetail` (form) interfaces;
`InventoryListFilters` (category, location, `expiring_within_days?`, `low_stock?`,
search, page, per_page). Also export `MEASUREMENT_SYSTEMS = ['us', 'metric'] as const`.

### 4.3 Units approach + base units

Two distinct concerns, kept separate:

1. **`unit` (per-item, free text)** — purely a display label the user types
   (`cans`, `rounds`). The system never math-converts it. It rides along with
   `quantity` for human readability.

2. **`resource_contribution` (calculator input)** — stored in a **fixed internal
   base unit** per `resource_type`, never in the user's display unit:

   | `resource_type` | Base unit (stored) | Rationale |
   |---|---|---|
   | `water` | **liters (L)** | SI base; clean conversion to/from US gallons. |
   | `food` | **kilocalories (kcal)** | Universal energy unit; needs are expressed per-person in kcal. |
   | `power` | **watt-hours (Wh)** | Standard for battery/solar capacity. |

   The user enters `resource_contribution` in their **preferred display unit**;
   the form converts to base for storage, and the detail/grid converts base back
   to the preferred unit for display. The calculator (Phase 2) always operates in
   base units, so the choice of display system never affects the math.

**Measurement-system preference** is a single KV key:

```
admin/types/kv_store.ts  →  'inventory.measurementSystem': 'string'   // 'us' | 'metric'
```

Default `'us'` (per the locked US-customary defaults). Read/written via
`KVStore.getValue/setValue`.

**Switching is a hard requirement (Chris, 2026-06-06: "make sure we can switch
between metric and imperial").** It is a first-class Settings control labelled
**Imperial / US ↔ Metric**. Because every measurable amount is stored in its base
unit, switching is **lossless and retroactive** — existing rows and the readiness
dashboard re-display in the newly chosen system instantly, with no data
migration. The toggle drives both inventory display and the Phase 2 calculator
defaults. Note: "Imperial" here means **US customary** (US gallon = 3.785411784 L),
**not** the UK imperial gallon (4.546 L) — confirm at review if UK units are ever
needed (would add a third `measurementSystem` value, not a code-path change).

**Conversion table** (the pure helper in §4.5 owns these constants):

| Resource | Base | US display unit | Metric display unit | Factor (display → base) |
|---|---|---|---|---|
| water | L | US gallon (`gal`) | liter (`L`) | `1 gal = 3.785411784 L`; metric = identity |
| food | kcal | kilocalorie (`kcal`) | kilocalorie (`kcal`) | identity both systems (kcal is unit-system-agnostic; included for a uniform API) |
| power | Wh | watt-hour (`Wh`) | watt-hour (`Wh`) | identity both systems |

Only water differs between systems today; food/power are identity. The helper
still routes all three through one signature so adding a future divergence is a
one-line change, not a new code path.

### 4.4 Service — `admin/app/services/inventory_service.ts`

`InventoryService` (CRUD + filtered reads; **no scanner**):

| Method | Returns | Behavior |
|---|---|---|
| `create(data)` | `InventoryItem` | Insert. |
| `update(id, data)` | `InventoryItem \| null` | Patch present fields only (Workshop `update` pattern). |
| `destroy(id)` | `boolean` | Delete row (no file to remove — pure record). |
| `find(id)` | `InventoryItem \| null` | Detail fetch. |
| `list(filters)` | paginated `InventoryItemSlim[]` | `category`, `location`, search by `name` (`whereILike`); `expiring_within_days` → `expiry_date <= today + N`; `low_stock` → `quantity <= restock_threshold AND restock_threshold IS NOT NULL`. |
| `sumByResource(resourceType)` | `{ total_base: number; rows: number }` | Phase 2 dependency: `SUM(resource_contribution) WHERE resource_type = ? AND resource_contribution > 0`. |
| `expiringBefore(date)` | `InventoryItem[]` | Phase 2 dependency: rows with `expiry_date < date` that contribute to a resource. |

Search is name-only (locked); no description field exists on items.

### 4.5 Pure helper — `admin/util/units.ts` (unit-tested)

The testable core. No DB, no Adonis imports — exactly the `embed_jobs.ts` shape.

Proposed signatures (final names confirmed at implementation):

```ts
export type MeasurementSystem = 'us' | 'metric'
export type ResourceType = 'water' | 'food' | 'power'

// Convert a value the user typed in their display unit into the stored base unit.
export function toBaseUnit(value: number, resource: ResourceType, system: MeasurementSystem): number

// Convert a stored base-unit value back into the user's display unit (for forms/grid).
export function fromBaseUnit(baseValue: number, resource: ResourceType, system: MeasurementSystem): number

// The display unit label for a resource under a system, e.g. ('water','us') => 'gal'.
export function displayUnitLabel(resource: ResourceType, system: MeasurementSystem): string

// Row-level low-stock predicate — pure, also used to badge cards.
export function isLowStock(quantity: number, restockThreshold: number | null): boolean

// "Expiring soon" predicate against a reference date.
export function isExpiringWithin(expiryDate: string | null, days: number, today: Date): boolean
```

Test cases (in `admin/tests/unit/units.spec.ts`): `1 gal → 3.7854 L` round-trips
within tolerance; metric water is identity; food/power identity both systems;
`fromBaseUnit(toBaseUnit(x)) ≈ x`; `isLowStock(2, 5) === true`, `(6, 5) === false`,
`(any, null) === false`; `isExpiringWithin` boundary at exactly N days, past
dates true, null false.

### 4.6 Validator — `admin/app/validators/inventory.ts`

`vine.compile` create + update validators (Workshop pattern):

- `createInventoryValidator`: `name` required `minLength(1).maxLength(255)`;
  `category` `vine.enum(INVENTORY_CATEGORIES)`; `quantity` `vine.number().min(0)`;
  `unit` `string().maxLength(32)`; `location`/`notes` nullable optional;
  `expiry_date` `vine.date()` nullable optional; `restock_threshold`
  `number().min(0)` nullable optional; `condition` `vine.enum(ITEM_CONDITIONS)`
  nullable optional; `resource_type` `vine.enum(RESOURCE_TYPES)` nullable
  optional; `resource_contribution` `number().min(0)` nullable optional.
- `updateInventoryValidator`: every field `.optional()` (same endpoint serves
  "filled it in" and "tweaked one field").
- `listInventoryValidator`: filters all optional, `per_page` capped (≤ 200).
- **Cross-field rule:** if `resource_type` is non-null, `resource_contribution`
  must be present and `> 0` (enforced with a Vine `requiredWhen`/refinement, or in
  the controller mirroring the `isMetadataComplete` recompute). Confirm location
  of this check at review (§9 Q4).

### 4.7 Controller — `admin/app/controllers/inventory_controller.ts`

`InventoryController` (Workshop controller shape):

| Method | Route | Notes |
|---|---|---|
| `index` | GET `/inventory` | Validate filters; paginate; render `inventory/index` with slim rows, pagination, filters, enums, `measurement_system`, and `mutations_permitted` (from `isLocalNetworkRequest`). |
| `show` | GET `/inventory/:id` | Integer-id guard; 404 if missing; render `inventory/show` with full row + enums + `measurement_system`. |
| `store` | POST `/api/inventory` | Validate; create; return `{ success, id }`. LAN-gated. |
| `update` | PATCH `/api/inventory/:id` | Validate; patch present fields; return `{ success }`. LAN-gated. |
| `destroy` | DELETE `/api/inventory/:id` | Delete; return `{ success }`. LAN-gated. |
| `mutationsPermitted` | GET `/api/inventory/mutations-permitted` | Non-gated probe; returns `isLocalNetworkRequest` shape so the UI shows form vs read-only. |

The "drive unavailable" branch from Workshop is **omitted** — Inventory has no
on-disk root.

### 4.8 Routes — `admin/start/routes.ts`

```
router.get('/inventory', [InventoryController, 'index'])
router.get('/inventory/:id', [InventoryController, 'show'])
router
  .group(() => {
    router.get('/mutations-permitted', [InventoryController, 'mutationsPermitted'])   // ungated probe
    router.post('/', [InventoryController, 'store']).use(middleware.localNetworkOnly())
    router.patch('/:id', [InventoryController, 'update']).use(middleware.localNetworkOnly())
    router.delete('/:id', [InventoryController, 'destroy']).use(middleware.localNetworkOnly())
  })
  .prefix('/api/inventory')
```

Mirrors the Workshop split: page GETs and the probe are ungated; every mutation
carries `.use(middleware.localNetworkOnly())`.

### 4.9 Inertia pages

- **`inventory/index.tsx`** (mirror `workshop/index.tsx`): card grid +
  `InventoryFilters` sidebar. Cards show name, category badge, `quantity unit`,
  and badges: amber **"Low stock"** when `isLowStock`, amber **"Expiring soon"**
  when within the configured window (a list-page default, e.g. 30 days), and a
  green **"Counts toward readiness"** dot when `contributesToReadiness`. Filter
  rail: category select, location select/text, "Only low stock" checkbox,
  "Expiring within N days" select, name search. An **"Add item"** button (visible
  only when `mutations_permitted`, else a LAN-only note like Workshop's
  `LanOnlyNotice`) opens the create form (route to `/inventory/new` or an inline
  modal — confirm at review, §9 Q3).
- **`inventory/show.tsx`** (mirror `workshop/show.tsx`): detail + edit form.
  Resource-mapping fields shown in their own labeled group; the
  `resource_contribution` input shows the display unit from `measurement_system`
  and converts on save via `units.ts`. Delete confirms first (but only deletes a
  DB row — copy reflects that, no "removes file from disk" language).

### 4.10 Home tile — `admin/inertia/pages/home.tsx`

Add `INVENTORY_ITEM` after `WORKSHOP_ITEM`:

```
const INVENTORY_ITEM = {
  label: 'Inventory',
  to: '/inventory',
  description: 'Track your supplies — food, water, meds, fuel, gear',
  icon: <IconClipboardList size={48} />,
  installed: true,
  displayOrder: 6,
  poweredBy: null,
}
```

Push it into `items` next to `WORKSHOP_ITEM` and import `IconClipboardList` from
`@tabler/icons-react`.

---

## 5. Phase 2 — Readiness Calculator (v0.2.62)

Reads Inventory; **stores no new stock data** (canonical data — one source of
truth, Maxim 4). The only new persisted state is the household config (KV).

### 5.0 Science grounding (HARD requirement — Chris, 2026-06-06)

Every daily-need value, multiplier, and target horizon the calculator uses **must
be grounded in an authoritative, cited source — not guessed by us.** Each number
carries its citation in this spec AND is surfaced in-app (a source note/tooltip
beside the figure) so the user sees *why* the target is what it is. Where no
credible source pins a value, it is shown as an **adjustable estimate** ("estimate
— set to your situation"), never presented as established fact. Phase 2 therefore
**opens with a sourcing pass** that replaces every default in §5.1 with a cited
figure before any UI is built. Candidate authorities to verify (NOT yet
confirmed): Ready.gov / FEMA / American Red Cross (emergency water ≈ 1
gal/person/day; supply horizon) and FDA nutrition labeling + USDA/HHS Dietary
Guidelines + NASEM Dietary Reference Intakes (calorie needs by age/sex/activity).
The same rule binds any Phase 3 scenario-plan guidance (quantities, procedures,
and especially anything medical): cite the source, or mark it a non-authoritative
starting point. We do not invent numbers a user might stake survival decisions on.

### 5.1 Household config (KV)

New `KV_STORE_SCHEMA` keys (all `'string'`-tagged, JSON-encoded where structured —
KV stores strings; the readiness service `JSON.parse`s with defensive fallback to
defaults, the `kv_store` consume pattern):

| Key | Shape | Default |
|---|---|---|
| `readiness.householdAdults` | integer-as-string | `'2'` |
| `readiness.householdChildren` | integer-as-string | `'0'` |
| `readiness.householdPets` | integer-as-string | `'0'` |
| `readiness.targetHorizonDays` | integer-as-string | `'14'` |
| `readiness.needs` | JSON `{ water: number; food: number; power: number }` per **adult** per day, in **base units** | `{ "water": 3.785411784, "food": 2000, "power": 0 }` |
| `readiness.childMultiplier` | float-as-string | `'0.5'` |
| `readiness.petMultiplier` | float-as-string | `'0.25'` |

These defaults are PLACEHOLDERS pending the §5.0 sourcing pass — confirm + cite
each against an authoritative source before shipping, or relabel as adjustable
estimates. Provisional: water ≈ 1 US gal/person/day (= 3.785 L; verify
Ready.gov/FEMA), food ≈ 2000 kcal/person/day (verify FDA/DGA — real needs vary by
age/sex/activity per NASEM DRIs), power configurable (default 0 = "not tracked
until you set it"). The child (0.5) and pet (0.25) multipliers are UNSOURCED
guesses: Phase 2 must either cite them (age-based water/calorie needs) or replace
them (e.g. count children as full persons for water per FEMA; use age-based
calorie references for food). Do not ship the multipliers as fact.

`power: 0` default means power readiness is dormant until the user sets a need;
the dashboard renders a "set a daily power need to track this" prompt rather than
a divide-by-zero (see §7).

### 5.2 The formula

For each `resource_type ∈ {water, food, power}`, in base units:

```
have        = InventoryService.sumByResource(resource).total_base       // Σ resource_contribution
effectivePeople = adults + children * childMultiplier + pets * petMultiplier
dailyNeed   = needs[resource] * effectivePeople                          // base units / day
days        = dailyNeed > 0 ? have / dailyNeed : null                    // null => "need not set"
target      = targetHorizonDays
gap         = dailyNeed > 0 ? max(0, (target * dailyNeed) - have) : 0     // base units short of target

status =
  dailyNeed <= 0           -> 'unset'
  days >= target           -> 'green'
  days >= target * yellowBand (e.g. 0.5) -> 'yellow'
  else                     -> 'red'
```

Plus an **expiry adjustment**: stock that `expiry_date < today + targetHorizonDays`
won't sustain the full horizon. The helper returns, per resource, the subset of
contributing items expiring before the horizon and the base-unit amount at risk,
so the dashboard can warn "X L of water expires before day 14." (Locked: flag it;
do not auto-deduct from `have` — keep `have` honest and surface the risk
separately. Confirm at review, §9 Q5.)

`yellowBand` constant (default 0.5) lives in the pure helper.

### 5.3 Pure helper — `admin/util/readiness.ts` (the highest-value tests)

```ts
export type ReadinessStatus = 'green' | 'yellow' | 'red' | 'unset'

export interface HouseholdConfig {
  adults: number
  children: number
  pets: number
  targetHorizonDays: number
  needs: { water: number; food: number; power: number }   // base units / adult / day
  childMultiplier: number
  petMultiplier: number
}

export interface ResourceReadiness {
  resource: 'water' | 'food' | 'power'
  have: number          // base units
  dailyNeed: number     // base units / day
  days: number | null   // null when dailyNeed <= 0
  target: number        // days
  gap: number           // base units short of target (0 if met or unset)
  status: ReadinessStatus
}

export function effectivePeople(c: HouseholdConfig): number
export function computeResourceReadiness(
  resource: 'water' | 'food' | 'power',
  haveBase: number,
  config: HouseholdConfig
): ResourceReadiness
```

**Worked example** (water, US defaults): `adults=2, children=2, pets=1`,
`childMultiplier=0.5, petMultiplier=0.25`, `needs.water=3.785 L`, `target=14`.
`effectivePeople = 2 + 2*0.5 + 1*0.25 = 3.25`. `dailyNeed = 3.785 * 3.25 ≈
12.30 L/day`. If `have = 200 L`: `days = 200 / 12.30 ≈ 16.3` → `status='green'`
(≥ 14), `gap = 0`. If `have = 100 L`: `days ≈ 8.1` → between `14*0.5=7` and `14`
→ `status='yellow'`, `gap = 14*12.30 - 100 ≈ 72.2 L`.

Tests (`admin/tests/unit/readiness.spec.ts` — the suite's most valuable):
`effectivePeople` weighting; green/yellow/red thresholds at boundaries; `days`/`gap`
arithmetic; `dailyNeed <= 0 → status 'unset', days null, gap 0` (no divide-by-zero);
zero `have` → `days 0`, `status 'red'`; large `have` → green.

### 5.4 Service, validator, controller, routes

- `ReadinessService.compute()` reads the seven KV config values (with defaults),
  calls `InventoryService.sumByResource` per resource and `expiringBefore(horizon)`,
  then `computeResourceReadiness` per resource, and assembles the dashboard DTO
  (three `ResourceReadiness` + expiry-warning list).
- `readiness.ts` validator validates the config-save payload (positive ints,
  non-negative needs, sane horizon ≤ e.g. 365).
- `ReadinessController.index` renders `readiness/index`; `saveConfig` (PATCH
  `/api/readiness/config`, LAN-gated) persists KV.
- Routes: `router.get('/readiness', ...)`; `/api/readiness/config` PATCH gated +
  an ungated `mutations-permitted` probe (same pattern as Inventory).

### 5.5 Dashboard page — `readiness/index.tsx`

Three `ResourceCard`s (water / food / power): big "N days" number, `have` (in the
user's display unit via `units.ts`), `target`, a green/yellow/red status pill, and
the `gap` ("need 72 L more to reach 14 days"). `unset` cards show a "set a daily
need" prompt linking to the config. Below the cards: an expiry-warnings panel
listing at-risk items with a link to each `/inventory/:id`. An editable household
config form (people counts, horizon, per-resource needs in display units) gated
behind `mutations_permitted`. Home tile `READINESS_ITEM`, `displayOrder: 7`,
icon e.g. `IconShieldCheck`.

---

## 6. Phase 3 — Scenario Plans (v0.2.63)

Editable, checkable per-scenario plans whose steps can cross-link to an inventory
item, an STL file, or a ZIM article.

### 6.1 Models

`ScenarioPlan` (table `scenario_plans`):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigIncrements` | no | |
| `scenario` | `string(32)` | no | Enum: `blackout, evacuation, medical, water-contamination, other`. |
| `title` | `string(255)` | no | |
| `description` | `text` | yes | |
| `created_at` | `timestamp` | no | autoCreate |
| `updated_at` | `timestamp` | no | autoCreate + autoUpdate |

**Steps: separate table, not a JSON column. Decision = `scenario_plan_steps`
table.** Justification: steps carry a *typed foreign cross-link* to three
different tables (`inventory_item_id`, `stl_file_id`, plus a ZIM ref). A relational
row makes those FKs explicit, lets the list query the steps with a `preload`, and
keeps `checked` togglable with a single-row PATCH instead of rewriting a whole
JSON blob (avoids lost-update races on rapid checkbox toggling). It mirrors the
relational style of the rest of the schema. (The Workshop `tags` JSON column is
the right call for a flat string array; a step with three nullable typed FKs and a
mutable boolean is not that shape.)

`ScenarioPlanStep` (table `scenario_plan_steps`):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigIncrements` | no | |
| `scenario_plan_id` | `bigInteger` | no | FK → `scenario_plans.id`, `onDelete('CASCADE')`. Indexed. |
| `position` | `integer` | no | Order within the plan (0-based). |
| `text` | `text` | no | The step instruction. |
| `checked` | `boolean` | no, default `false` | User progress. |
| `link_type` | `string(16)` | yes | Enum: `inventory, stl, zim` (or null = no link). |
| `inventory_item_id` | `bigInteger` | yes | FK → `inventory_items.id`, `onDelete('SET NULL')`. Set when `link_type='inventory'`. |
| `stl_file_id` | `bigInteger` | yes | FK → `stl_files.id`, `onDelete('SET NULL')`. Set when `link_type='stl'`. |
| `zim_ref` | `string(512)` | yes | Set when `link_type='zim'` — see §6.2. |
| `created_at` / `updated_at` | `timestamp` | no | |

Indexes: `idx_scenario_steps_plan` on `scenario_plan_id`; `idx_scenario_plans_scenario`
on `scenario`.

Lucid relations: `ScenarioPlan hasMany ScenarioPlanStep`; steps `belongsTo`
`InventoryItem` / `StlFile` (nullable). The `SET NULL` on FK ensures deleting an
inventory item or STL file degrades a step's link to "unlinked" rather than
breaking the plan (data-cascade safety, Maxim 5).

### 6.2 Cross-link model

A step links to **at most one** target, identified by `link_type`:

- `inventory` → `inventory_item_id` → resolves to `/inventory/:id`.
- `stl` → `stl_file_id` → resolves to `/workshop/:id`.
- `zim` → `zim_ref` (a string the ZIM reader understands — e.g.
  `<zimFileName>|<articlePath>` or the reader URL). The ZIM reader is the Kiwix
  service reached via `getServiceLink` (`admin/inertia/lib/navigation.ts`); the
  exact ZIM ref format and how the reader URL is built is **§9 Q6** to confirm at
  review (depends on the Kiwix service's URL scheme). Store the raw ref; resolve
  to a URL in the pure helper.

### 6.3 Pure helper — `admin/util/scenario_links.ts` (unit-tested)

```ts
export type StepLinkType = 'inventory' | 'stl' | 'zim'

export interface StepLink {
  type: StepLinkType
  href: string         // where the UI navigates
  label: string        // resolved display label or a fallback
  resolved: boolean    // false if the target was deleted / ZIM not installed
}

// Pure: given the step's link fields + a resolver context (already-fetched
// names + the kiwix base), produce the StepLink the UI renders. No DB calls.
export function resolveStepLink(step: {
  link_type: string | null
  inventory_item_id: number | null
  stl_file_id: number | null
  zim_ref: string | null
}, ctx: {
  inventoryName?: string | null
  stlName?: string | null
  kiwixBaseUrl?: string | null
}): StepLink | null
```

Tests (`scenario_links.spec.ts`): each link type produces the right `href`
(`/inventory/12`, `/workshop/7`, the kiwix URL); a deleted target (FK now null
but `link_type` set) yields `resolved: false` with a fallback label; `link_type:
null` returns `null`; missing kiwix base yields `resolved: false`.

### 6.4 Service / validator / controller / routes

- `ScenarioService`: CRUD on plans; add/update/delete/reorder steps; `toggleStep`
  (single-row `checked` PATCH); `list` with step counts; `find` preloads steps +
  link targets' names for the detail page.
- `scenarios.ts` validators: create/update plan; create/update step (text
  required; `link_type` enum nullable; the matching id/ref required when
  `link_type` set; `position` int).
- `ScenarioController`: `index` (`scenarios/index`), `show` (`scenarios/show`),
  and the LAN-gated mutations (`store`, `update`, `destroy`, `storeStep`,
  `updateStep`, `toggleStep`, `destroyStep`, `reorderSteps`) + the ungated
  `mutations-permitted` probe.
- Routes under `/scenarios` (pages) and `/api/scenarios/*` (mutations gated),
  same split as the others.

### 6.5 Inertia pages

- **`scenarios/index.tsx`**: list of plans grouped/badged by `scenario`, each
  card showing title, scenario badge, and "X / Y steps done". "New plan" button
  gated.
- **`scenarios/show.tsx`**: plan header (title, scenario, description) + an
  ordered, checkable step list (`ScenarioStep` component). Each step renders its
  resolved cross-link as a real link (to `/inventory/:id`, `/workshop/:id`, or the
  ZIM reader); unresolved links show a muted "linked item removed" note. Checking
  a box PATCHes `toggleStep` (gated). Edit mode (add/edit/reorder/delete steps)
  gated behind `mutations_permitted`.

### 6.6 Seeds — `admin/database/seeders/scenario_plan_seeder.ts`

Starter templates so the feature isn't empty on first open (locked: "seed a few").
Suggested set (final copy at review):

- **Blackout** — check fuel for generator (`link: inventory`), locate flashlights
  + batteries (`link: inventory`), read "Power outage safety" (`link: zim`).
- **Evacuation** — grab-bag checklist (water, meds, docs), print a luggage tag
  (`link: stl`), fuel vehicle.
- **Water contamination** — locate stored water (`link: inventory`), boil-water
  procedure (`link: zim`), print a filter adapter (`link: stl`).

Seeder is idempotent (skip if a seeded plan with the same title already exists) so
re-running on upgrade doesn't duplicate. Home tile `SCENARIOS_ITEM`,
`displayOrder: 8`, icon e.g. `IconListCheck`.

---

## 7. Error handling & edge cases

| Case | Handling |
|---|---|
| **Empty inventory** (Phase 2) | `sumByResource` returns 0; `have=0`, `days=0`, `status='red'` (if a need is set). Dashboard renders red cards, not an error. |
| **Missing household config** (Phase 2) | `ReadinessService` falls back to the documented defaults for any unset/parse-failing KV key (defensive `JSON.parse` like `kv_store` consume). The page always renders. |
| **`dailyNeed <= 0` (need unset, e.g. power default 0)** | No division: `days=null`, `status='unset'`, `gap=0`. Card shows "set a daily need to track." Guarded in the pure helper + tested. |
| **Unit conversion** | All math is in base units; conversion only at the form boundary (save) and display (render). `fromBaseUnit(toBaseUnit(x)) ≈ x` is unit-tested with a tolerance (floating point). Free-text `unit` is never converted. |
| **Expiry math** | "Expiring soon" / horizon comparisons use date-only (`expiry_date` is a `date`, no time component); compare against `today` computed once per request. Null `expiry_date` never counts as expiring. Boundary (exactly N days) is tested. |
| **Resource-mapping integrity** | `resource_type` set but `resource_contribution` null/≤0 → the cross-field validator rejects on save; the calculator's `sumByResource` already excludes `contribution <= 0`, so a stray bad row can't corrupt totals. |
| **Deleted cross-link target** (Phase 3) | FK `SET NULL` degrades the step to unlinked; `resolveStepLink` returns `resolved:false` with a fallback label; the UI shows "linked item removed." No 500. |
| **ZIM not installed** (Phase 3) | If the kiwix base/ZIM is unavailable, `resolveStepLink` returns `resolved:false`; the step text still renders. |
| **LAN gating bypass** | Any direct POST/PATCH/DELETE from off-LAN hits `localNetworkOnly` → 403 with the standard reason body, regardless of UI state. The ungated `mutations-permitted` probe drives the UI's read-only vs editable rendering (Workshop pattern). |
| **Invalid id param** | Integer-id guard returns 404 (page) / 400 (api) like the Workshop controller. |
| **Concurrent step toggles** (Phase 3) | Single-row `checked` PATCH (not a JSON-blob rewrite) avoids lost updates — a direct consequence of the table-not-JSON decision (§6.1). |

---

## 8. Testing strategy

**Why the Japa suite cannot run locally:** the integration/functional tests boot
AdonisJS, which requires MySQL/MariaDB + Redis connections that are not available
in the dev/CI shell. So the test contract for this suite is the **pure-helper**
pattern proven by `admin/util/embed_jobs.ts` + `admin/tests/unit/embed_jobs.spec.ts`:
logic worth testing is extracted into dependency-free functions in `admin/util/*.ts`
and exercised with `@japa/runner` `test.group` + `assert` against in-memory inputs.

**The two gates, run on every phase:**

1. `tsc --noEmit` in `admin/` — the compile gate (catches type drift across the
   types → model → controller → inertia chain).
2. Pure-helper unit tests — the behavior gate:
   - Phase 1: `admin/util/units.ts` → `units.spec.ts` (conversions round-trip,
     low-stock + expiring predicates).
   - Phase 2: `admin/util/readiness.ts` → `readiness.spec.ts` (the calculator —
     the highest-value tests in the suite: weighting, status thresholds, gap,
     no divide-by-zero).
   - Phase 3: `admin/util/scenario_links.ts` → `scenario_links.spec.ts`
     (link resolution per type, deleted-target fallback, null link).

**What is NOT unit-tested** (no pure-helper seam, would require a booted DB):
controllers, services' DB queries, migrations, Inertia rendering. These are
covered by `tsc` + manual verification on a running instance, consistent with how
Workshop ships in this fork.

**CI:** the existing **Build macOS-distribution admin image** workflow (runs
`node ace build`) is the integration gate — a green build proves the whole chain
compiles and bundles. Each phase's PR must show that workflow green plus the
phase's `*.spec.ts` passing.

**Deploy:** each release ships via `nomad upgrade`.

---

## 9. Open questions for spec review

1. **Q1 — Phase boundaries as separate PRs/releases:** confirm three discrete
   PRs + three `nomad upgrade`-deployed tags (`0.2.61/62/63`), not one combined
   merge.
2. **Q2 — `quantity`/`resource_contribution` precision:** `decimal(12,3)` /
   `decimal(14,3)` proposed. Confirm 3 decimal places is enough (covers "2.5 gal",
   "0.125 kg"); raise scale if finer is needed.
3. **Q3 — Inventory create UX:** dedicated `/inventory/new` page vs an inline
   modal on the index. Spec assumes a create form reusing the `show.tsx` field set;
   confirm the entry point.
4. **Q4 — Cross-field validation location:** enforce "`resource_type` set ⇒
   `resource_contribution > 0`" in the Vine validator (`requiredWhen`) vs the
   controller recompute. Spec leans Vine; confirm.
5. **Q5 — Expiry vs the calculator:** flag expiring stock separately (proposed)
   vs deduct it from `have` so `days` already reflects the loss. Spec flags
   separately to keep `have` honest. Confirm.
6. **Q6 — ZIM cross-link ref format:** the exact `zim_ref` string + how the reader
   URL is constructed (Kiwix service URL scheme via `getServiceLink`). Needs the
   current Kiwix article-URL convention; confirm format at Phase 3 start.
7. **Q7 — Default daily-need values:** water 1 gal (3.785 L), food 2000 kcal,
   power 0 (dormant), child ×0.5, pet ×0.25, horizon 14 days. Confirm these
   locked defaults are the ones to ship.
8. **Q8 — Yellow band:** `status='yellow'` when `target*0.5 ≤ days < target`.
   Confirm the 0.5 band (vs e.g. 0.75).
9. **Q9 — Home tile order + icons:** Inventory `displayOrder 6` /
   `IconClipboardList`, Readiness `7` / `IconShieldCheck`, Scenarios `8` /
   `IconListCheck`. Confirm placement after Workshop (5) and icon choices.
10. **Q10 — Seed templates (Phase 3):** confirm the starter set (Blackout,
    Evacuation, Water contamination) and their step copy/links.
