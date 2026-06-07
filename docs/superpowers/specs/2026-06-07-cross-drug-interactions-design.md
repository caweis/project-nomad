---
type: design-spec
status: draft-for-review
date: 2026-06-07
project: project-nomad (macOS / Apple-Silicon fork)
feature: Cross-drug interactions v1 — side-by-side label view (#9)
decided_by: Chris (2026-06-07) — direction LOCKED (side-by-side, NOT a pairwise checker)
data_source: existing drug_labels.drug_interactions (openFDA, CC0)
tags: [nomad, macos, drug-reference, interactions, openfda, offline]
---

# Cross-drug interactions v1 — side-by-side label view (#9)

A view that shows, for two or more selected drugs, **each drug's own FDA-labeled
`drug_interactions` text in side-by-side columns**. It is explicitly **not** a
pairwise interaction checker — it surfaces what we already have (the openFDA
Section-7 interaction prose, already ingested by Drug Reference) so a user can
quickly compare labeled warnings across drugs they're looking at.

## Why this and not a real checker

Research (2026-06-07, captured in MemPalace `project_nomad/decisions`) found **no
openly + commercially-redistributable, curated pairwise drug-drug-interaction
dataset** suitable for an offline appliance: DDInter 2.0 is CC BY-NC, DrugBank
requires a paid commercial license, and TWOSIDES (the only maybe-permissive
pairwise source) has an unconfirmed license plus FAERS-signal/2014-vintage
quality caveats. The only fully-clean, in-corpus data is the single-drug
`drug_interactions` label text. So v1 is honest: it shows each drug's labeled
interactions side by side, clearly disclaimed. A real pairwise checker
(TWOSIDES-based) is deferred and gated on a license confirmation + `rxcui`
re-ingest (see "Deferred").

## What this is NOT
- Not a pairwise checker. It does not compute or assert that Drug A interacts
  with Drug B. It shows each drug's own label text independently.
- Not medical advice. It carries a prominent disclaimer and the CC0 source line.

---

## 1. Data — already in the corpus

`drug_labels` already has `drug_interactions` (mediumtext), `brand_name`,
`generic_name`, `product_type`. **No migration, no new ingest, no new deps.**
A drug with no `drug_interactions` on its label shows a clear "No labeled
interaction text on this label" note (verified-common: many OTC labels omit it).

---

## 2. Backend

### 2.1 Service — `DrugReferenceService.getInteractionsFor(ids)`
```ts
interface DrugInteractionEntry {
  id: number
  brand_name: string | null
  generic_name: string | null
  product_type: string | null
  drug_interactions: string | null
}
getInteractionsFor(ids: number[]): Promise<DrugInteractionEntry[]>
```
- Dedupe + cap the id list at **MAX_COMPARE = 5** (a side-by-side view past ~5
  columns is unreadable; the validator also enforces this).
- One query: `SELECT id, brand_name, generic_name, product_type,
  drug_interactions FROM drug_labels WHERE id IN (?)`. Preserve the requested
  order in the mapped result (so columns match the user's selection order).
- Returns `[]` for an empty/invalid id list.

### 2.2 Controller — `DrugReferenceController`
- `interactions({ inertia })` — renders the Inertia page (passes `rowCount` +
  ingest status so the empty state can prompt a download, like the search page).
- `interactionsApi({ request })` — `GET /api/drug-reference/interactions?ids=1,2,3`
  → validate → `service.getInteractionsFor(ids)` → `{ entries }`. Never leak
  exceptions; integer-guard each id.

### 2.3 Validator
`interactionsValidator`: `ids` — a required, comma-separated list parsed to a
`number[]` of positive integers, length 1..5. (Parse the CSV in the controller,
or accept `ids` as a repeated query param; validate each is a positive int.)

### 2.4 Routes (ungated, read-only — mirror the existing Drug Reference routes)
```
router.get('/drug-reference/interactions', [DrugReferenceController, 'interactions'])
// inside the /api/drug-reference group:
router.get('/interactions', [DrugReferenceController, 'interactionsApi'])
```

---

## 3. UI — `inertia/pages/drug-reference/interactions.tsx`

- **Drug picker:** reuse the existing search (the `/api/drug-reference/search`
  call + result rows). Each result has an "Add" action; selected drugs render as
  removable chips (max 5). The picker is the same collapsed brand+generic search
  already shipped.
- **Comparison view:** responsive columns (side-by-side on desktop, stacked on
  mobile). Each column: drug name (brand + generic) + OTC/Rx badge, then the
  `drug_interactions` text (preserve paragraphs), or a muted "No labeled
  interaction text on this label."
- **Disclaimer banner (prominent, amber), always visible above the columns:**
  > This shows each drug's **own** FDA-labeled interaction warnings,
  > individually. It is **not** a cross-drug interaction checker and is **not**
  > a substitute for professional medical review. Absence of text here does not
  > mean a drug is safe to combine.
- **Source footer:** the same CC0 "Source: U.S. FDA via openFDA — public domain
  (CC0). NOMAD is not affiliated with or endorsed by the FDA." line used on the
  search/detail pages.
- **Empty state** (`rowCount === 0`): "No FDA drug data yet" → link to the Drug
  Reference download (reuse the existing IngestStatus/empty-state pattern).

### 3.1 Entry points
- A **"Compare interactions"** button on the Drug Reference search page header.
- On a drug's **detail page** (`show.tsx`), an "Add to interaction comparison"
  action that opens the interactions view with that drug preselected
  (`/drug-reference/interactions?ids=<id>`).

---

## 4. Error handling / edge cases

| Case | Behavior |
|---|---|
| No data ingested (`rowCount === 0`) | Empty state + download prompt. |
| Drug has no `drug_interactions` | Column shows "No labeled interaction text on this label." |
| >5 ids requested | Validator caps at 5; extras ignored with a UI note. |
| Invalid/non-existent id | Skipped; missing columns simply don't render. |
| 0 ids | Page shows the picker + a "Select drugs to compare" prompt. |

---

## 5. Testing
- Pure/unit: the id-list parse+cap+dedupe logic is extractable to a tiny pure
  helper (`parseCompareIds(raw): number[]`) and unit-tested (CSV parse, dedupe,
  cap at 5, drop non-positive/non-integer). No DB.
- tsc: backend 0, inertia at baseline. No new node deps.
- Live (mini): pick 2–3 drugs (one Rx with rich interactions, one OTC without),
  confirm columns render the right text + the "no text" note, disclaimer shows.

## 6. Files to create / modify
```
CREATE admin/inertia/pages/drug-reference/interactions.tsx
CREATE admin/inertia/components/drug-reference/InteractionColumn.tsx
CREATE admin/util/compare_ids.ts            (PURE parseCompareIds + cap/dedupe)
CREATE admin/tests/unit/compare_ids.spec.ts
EDIT   admin/app/services/drug_reference_service.ts   (getInteractionsFor)
EDIT   admin/app/controllers/drug_reference_controller.ts (interactions + interactionsApi)
EDIT   admin/app/validators/drug_reference.ts         (interactionsValidator)
EDIT   admin/start/routes.ts                          (2 routes)
EDIT   admin/inertia/pages/drug-reference/index.tsx   ("Compare interactions" entry)
EDIT   admin/inertia/pages/drug-reference/show.tsx    ("Add to comparison" entry)
EDIT   admin/types/drug_reference.ts                  (DrugInteractionEntry)
```
No migration. No new node deps. No new ingest.

## 7. Deferred — the real pairwise checker
A TWOSIDES-based pairwise checker (the thing #9 originally implied) is deferred
and gated on: (1) Chris confirming the TWOSIDES license in writing with the
Tatonetti Lab, (2) accepting the FAERS-signal / 2014-vintage caveats in the UI,
(3) re-ingesting `openfda.rxcui` to map our labels to TWOSIDES' RxCUI keys.
Tracked in the MemPalace decision drawer; not part of v1.

## 8. Open questions (confirm at review)
1. Entry points — confirm both the search-page button and the detail-page "add
   to comparison" are wanted (vs just one).
2. MAX_COMPARE = 5 — confirm the cap.
3. Should the comparison selection persist (URL `?ids=` is the source of truth,
   shareable/bookmarkable) — proposed yes (URL-driven, no server state).
