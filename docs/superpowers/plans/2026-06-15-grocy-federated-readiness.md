# Grocy Federated Readiness — design + implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, commit per task.
> **Status:** designed + grounded in audited investigation 2026-06-15. Honest-v1 approved by Chris. Review before building.
> Memory: `grocy-preparedness-architecture`. Grocy container shipped in `071ea41` (`nomad_grocy`, port 8400).

**Goal:** Our Supply Readiness ("days of supply") reads food/calorie stock from the Grocy container's REST API and folds it into the unified picture across food + water + power, degrading gracefully when Grocy is absent — without fabricating a food-supply number we can't stand behind.

**Architecture:** A read-only `GrocyClient` (server-side, in the admin) calls Grocy's REST API on the internal network; a pure `grocyFoodEnergy()` computes total kcal-on-hand **with coverage**; `ReadinessService.compute()` uses that as the food numerator when Grocy is reachable, else falls back to in-app inventory food rows. No change to the pure calc (`util/readiness.ts`). One new DTO flag drives a per-card UI state.

**Tech Stack:** AdonisJS 6 (admin), TypeScript, KV store for config, standalone `*.standalone.ts` tests (`node --experimental-strip-types`).

---

## What the investigation established (audited against code + Grocy primary sources)

- **The seam is one additive term.** `ReadinessService.compute()` (readiness_service.ts:57-60) runs `sumByResource('food')` → `foodSum.total_base` (kcal) → `computeResourceReadiness('food', …, foodSum.total_base, …)` at :83. Food's base unit is `kcal` (inventory.ts:74). The pure calc (`util/readiness.ts`, `days = have / dailyNeed`) needs NO change — Grocy enlarges/replaces the food numerator.
- **Grocy's `calories` is real but usually empty.** First-class per-product field (kcal per stock unit), but optional, not auto-populated, and does NOT roll up parent→child (verified: Grocy issues #1241/#1682/#268, v2.5.0 notes). A naive "food-days from Grocy calories" reads near-zero for most users. → **honest-v1: compute from the products that HAVE calorie data, show coverage, never fabricate.** Days-of-food-supply is a number people bet preparedness decisions on (Maxim 15).
- **4 cheap API calls**, cached: `/api/stock`, `/api/objects/products`, `/api/objects/quantity_units`, `/api/objects/quantity_unit_conversions`. Auth = `GROCY-API-KEY` header (user pastes a key from Grocy's UI; no programmatic minting). For the kcal calc, units cancel (`calories × amount`, both per stock QU) — no conversion needed.
- **Canonical-data rule:** Grocy owns food. When Grocy is reachable, the food numerator = Grocy kcal (do NOT also add in-app `resource_type='food'` rows — that double-counts). When Grocy is down, fall back to in-app food rows. Never sum both.

---

## File Structure

**Create:**
- `admin/app/services/grocy_client.ts` — server-side REST client (auth header, the 4 GETs, typed responses, timeout). Reads config from KV.
- `admin/app/services/grocy_food_energy.ts` — **pure** `computeFoodEnergy(products, stock)` → `{ totalKcal, coveredProducts, totalProducts }`. No framework deps (testable standalone).
- `admin/constants/grocy.ts` — KV keys (`grocy.baseUrl`, `grocy.apiKey`, `grocy.enabled`), default internal URL (`http://nomad_grocy:80`).
- `admin/tests/standalone/grocy_food_energy.standalone.ts` — pure test of the kcal + coverage math (mocked Grocy JSON).

**Modify:**
- `admin/app/services/readiness_service.ts` — wrap a Grocy fetch in try/catch; when reachable, food numerator = Grocy kcal; else in-app `foodSum.total_base`. Water/power untouched (must render even if Grocy throws).
- `admin/types/readiness.ts` — add `foodSource: 'grocy' | 'inventory'` + `grocyCoverage?: { covered: number; total: number }` to `ReadinessDashboard`.
- `admin/inertia/pages/readiness/index.tsx` — the food card reads `foodSource`/`grocyCoverage`: shows "from Grocy (N of M products have calorie data)" or "Grocy unavailable — showing local inventory."
- `admin/app/controllers/settings_controller.ts` + a settings page — Grocy connection config (base URL prefilled to the container, API key field). Key persisted in KV **server-side only**, never sent to the client (mask in UI).
- `admin/constants/kv_store.ts` — register the 3 grocy KV keys in `KV_STORE_SCHEMA`.

---

## Task 1: Pure food-energy computation (kcal + coverage)
**Files:** create `grocy_food_energy.ts` + `grocy_food_energy.standalone.ts`.
- [ ] Failing test: given mock products (`[{id, calories, qu_id_stock}]`) + stock (`[{product_id, amount}]`), `computeFoodEnergy` returns `totalKcal = Σ(calories × amount)` over products WITH `calories > 0`, plus `covered`/`total` counts. Assert: products without calories contribute 0 and lower coverage; uses non-aggregated `amount` (no parent/child double-count).
- [ ] Run → FAIL. Implement the pure function (no imports beyond types). Run → PASS. Commit.

## Task 2: GrocyClient (server-side REST)
**Files:** create `grocy_client.ts`, `grocy.ts`; modify `kv_store.ts`.
- [ ] KV keys: `grocy.enabled` (bool), `grocy.baseUrl` (default `http://nomad_grocy:80`), `grocy.apiKey`. Register in `KV_STORE_SCHEMA`.
- [ ] `GrocyClient`: `fetchProducts()`, `fetchStock()` (+ QU/conversions if needed later), each `GET` with `GROCY-API-KEY` header + a short timeout (e.g. 3s). `isConfigured()` = enabled + baseUrl + apiKey present. Throws on network/HTTP error (caller catches).
- [ ] `totalFoodEnergyKcal()`: fetch products + stock, call `computeFoodEnergy`, return `{ totalKcal, covered, total }`. (No standalone test — framework-coupled; covered by Task 1's pure test + manual verify against a live Grocy.)
- [ ] Typecheck + lint. Commit.

## Task 3: ReadinessService integration (the seam + graceful degradation)
**Files:** modify `readiness_service.ts`, `types/readiness.ts`.
- [ ] In `compute()`: after the existing `Promise.all`, attempt Grocy ONLY if `GrocyClient.isConfigured()`, wrapped in try/catch so a Grocy failure never rejects water/power. On success: `foodHave = grocy.totalKcal`, `foodSource='grocy'`, `grocyCoverage={covered,total}`. On failure or not-configured: `foodHave = foodSum.total_base`, `foodSource='inventory'`. Pass `foodHave` to `computeResourceReadiness('food', …)` at :83.
- [ ] Add the DTO fields. Verify water/power readiness are byte-identical when Grocy is down (no regression).
- [ ] A standalone test of the source-selection logic (pure helper: given grocy result|null + inventory total → which numerator + foodSource). Run → PASS. Commit.

## Task 4: UI — food card source/coverage + degraded state
**Files:** modify `readiness/index.tsx`.
- [ ] The food resource card renders: `foodSource==='grocy'` → "Food from Grocy · N of M products have calorie data" (+ a subtle nudge when coverage is low); `'inventory'` → "Grocy unavailable — showing local inventory." Water/power cards untouched.
- [ ] Manual render verify (Grocy configured vs not). Commit.

## Task 5: Settings — Grocy connection config
**Files:** modify `settings_controller.ts` + a settings page/section.
- [ ] A "Grocy" settings section: enable toggle, base URL (prefilled to the container), API key (write-only; never echoed back to the client — show "set/unset"). Persist via the existing `PATCH /api/system/settings` KV path. A "Test connection" action that calls `GrocyClient.fetchStock()` and reports reachable/coverage.
- [ ] Security: the API key lives in KV, read server-side by `GrocyClient` only; never serialized into Inertia props. Note the SSRF surface (server fetches a user-set URL on a localhost admin — acceptable, flagged). Commit.

## Verification gate
- [ ] Standalone tests green (`grocy_food_energy`, source-selection).
- [ ] Readiness dashboard renders with Grocy configured (food from Grocy + coverage) AND with Grocy down (falls back to inventory; water/power unaffected).
- [ ] API key never appears in client props/network (inspect the Inertia payload).
- [ ] No fabricated food-days: coverage shown whenever food is Grocy-sourced.
- [ ] Operator (mini): install Grocy, add products with/without calories, confirm the food card + coverage behave.

## Deferred (own issues)
- **v2 calorie enrichment** — NOMAD per-food-group kcal heuristic for products Grocy lacks calories on. Heavily-labeled estimate. Only if coverage proves too sparse in practice; risks false confidence, so not in v1.
- **Inventory cedes food UI** — hide/deprecate the in-app `food` category once Grocy is the food system (so users don't double-enter). Separate, small.
