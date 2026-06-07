---
type: audit
date: 2026-06-07
scope: canonical + cascading data audit of the session's new features
features: [Drug Reference (#8/#11/#9), Workshop maker library (#6/#7), Preparedness suite (Inventory/Readiness/Scenario Plans)]
maxims: [4 canonical, 5 cascade, 6 wire-in, 7 db-sync]
result: 0 high · 11 medium · 11 low
method: 3 parallel read-only audit subagents, Opus-synthesized
---

# Canonical + Cascading Data Audit — 2026-06-07

Requested by Chris after live testing surfaced data bugs (readiness cards not
cascading; inventory unit required for gear). Three read-only audit agents
checked every new feature against Maxim 4 (canonical / one source of truth),
Maxim 5 (cascade / no orphaned-stale refs), Maxim 6 (wire-in / no dead data),
Maxim 7 (db-sync / schema↔code).

**No HIGH-severity / data-corrupting findings.** The user-blocking bugs are
already fixed (shipped 0.2.77). The rest are correctness/UX refinements.

## Already fixed (shipped 0.2.77)
- Drug Reference restart after a failed/stalled ingest (deterministic jobId was
  held by the failed job) — `dispatch()` now clears a failed/completed job first.
- Inventory `unit` required for gear (e.g. a water filter) — now optional
  (= Preparedness Finding 1 minimal fix; DB column is NOT NULL default '', no
  migration). Form also surfaces field-level 422 messages.
- Readiness cards now recompute live from household inputs (cascade fix).

---

## Drug Reference — 0 high / 2 med / 4 low
- **MED** Cascade: re-ingest is additive-only — a `set_id` retired upstream
  leaves a stale row forever. Fix: stamp an ingest-start time, then
  `DELETE FROM drug_labels WHERE ingested_at < start` after the final part.
- **MED** Canonical: KV `lastUpdatedExportDate` vs `rowCount` can desync on a
  partial-ingest failure (rows present, marker null → UI shows "completed" with
  no version). Fix: a partial-progress marker + distinguish partial vs full in
  `getIngestStatus`.
- **LOW** `ingested_at` is in the detail DTO but never rendered (dead payload).
- **LOW** `downloadDrugValidator` defined but unused (dead export).
- **LOW** `ingested_at` NOT NULL with no DB default — bulk-upsert relies on the
  ORM hook; add `.defaultTo(CURRENT_TIMESTAMP)` as a safety net.
- **LOW** No admin path to reset the KV marker / truncate (operator recovery).

## Workshop maker library (#6/#7) — 0 high / 4 med / 4 low
- **MED** Cascade: `pdf_text_extract` not reset when a PDF's content changes
  (hash-changed branch resets thumbnail but not text). Fix: null it in the
  `hashChanged` block.
- **MED** Wire-in: `pdf_text_extract` populated + shown in detail but NOT in the
  list search (only name/description). Half-wired. Fix: add it to the search
  `orWhereILike`.
- **MED** Cascade: `.thumbnails/pdf-pages/{id}/` orphaned on file delete —
  `deleteRowFiles`/`removeOrphans` only unlink the single thumbnail. Fix:
  `fs.rm(pdf-pages/{id}, {recursive})` in both.
- **MED** Cascade/db-sync: `file_type` not recomputed on the UPDATE branch — a
  file renamed on disk (`.stl`→`.pdf`) keeps a stale `file_type`. Fix: recompute
  in the UPDATE branch (+ null pdf_text_extract if type changed away from pdf).
- **LOW** Migration comment "first 5 pages" vs actual (all pages, 20 KB cap).
- **LOW** `StlFileDetail` type omits `pdf_text_extract` (intentional lazy-fetch;
  add optional field or a doc note).
- **LOW** `update()` applies `infill_pct`/material/etc. for non-STL types
  (validator isn't type-aware). Fix: skip STL-only fields when file_type≠stl.
- **LOW** `has_pdf_text` computed for all types, not gated to pdf (cosmetic).

## Preparedness suite — 0 high / 5 med / 3 low
- **MED** Canonical: no `kind` discriminator (consumable vs gear) — fields
  coexist on one row. Minimal fix (unit optional) DONE in 0.2.77; the clean fix
  is a `kind` enum to scope expiry/restock/resource logic. Deferred decision.
- **MED** Cascade: scenario-step link uses ON DELETE SET NULL (correct, no
  orphan), but a removed link goes silent (label blanks). Fix: persist a
  `linked_name_snapshot` so the UI shows "⚠ was: <name>".
- **MED** Cascade: expiry boundary mismatch — readiness `expiringBefore` uses
  `<` while the inventory list filter uses `<=`; an item expiring exactly on the
  horizon shows in one view, not the other. Fix: make `expiringBefore` `<=`.
- **MED** Canonical: `needs.power` in the KV blob is written then immediately
  zeroed (dead intermediate code in readiness onSave). Fix: build the needs
  literal with `power: 0` directly.
- **MED** Wire-in: `condition` column is detail-only — not in the list DTO,
  filters, or card. Fix: add to `InventoryItemSlim` + a condition filter.
- **LOW** `scenario_plan_steps` uses `created_at` vs the suite's `added_at`.
- **LOW** No index on `restock_threshold` (low-stock filter full-scans).
- **LOW** `contributesToReadiness` predicate duplicated (card vs model) — extract
  to `util/units.ts`.

---

## Recommended fix order (next session)
**Quick wins (low-risk, no migration):** expiry boundary `<`→`<=`; `needs.power`
dead-write cleanup; `pdf_text_extract` reset on hash-change; `file_type`
recompute on UPDATE; pdf-pages cleanup on delete; pdf text in list search;
`has_pdf_text` type guard; STL-only fields guarded in `update()`.

**Need a migration:** Drug Reference stale-row purge (ingest-start stamp +
delete); `ingested_at` DB default; `restock_threshold` index;
`scenario_plan_steps.created_at`→`added_at` rename; (optional) inventory `kind`
discriminator + scenario `linked_name_snapshot`.

**Decisions for Chris:** (a) inventory `kind` discriminator now or later;
(b) Drug Reference partial-ingest marker UX; (c) whether `condition` browsing
matters enough to wire fully.
