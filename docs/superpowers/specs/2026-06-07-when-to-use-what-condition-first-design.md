---
type: design-spec
date: 2026-06-07
status: approved
feature: "When to use what" — condition-first medical reference (drugs + natural remedies)
answers: Crosstalk-Solutions/project-nomad Discussion #664 (Ideas — "Add medical/Rx info")
target_version: 0.2.7xx patches (own sessions; two phases)
decided_by: Chris (2026-06-07 brainstorm)
related:
  - Drug Reference v1 (#8) — openFDA labels
  - indication search (#11) — "search by what it treats" FULLTEXT
  - offline-library cross-reference (#15) — ZIM deep-links
  - docs/superpowers/specs/2026-06-07-drug-reference-offline-library-crossref-design.md
tags: [drug-reference, natural-remedies, conditions, nccih, when-to-use-what]
---

# "When to use what" — Condition-First Medical Reference

## Goal

Reframe NOMAD's medical surface around **situations**. The user picks (or
searches) a situation — burn, fever, diarrhea, wound, allergic reaction — and
sees what to use for it: relevant OTC drugs AND natural remedies, each cited and
carrying safety cautions. This completes upstream Idea #664, whose requester
asked for "a reference for drugs … and natural remedies-type info … when to use
what in different situations." We shipped the drug half (Drug Reference v1);
this is the situation-first reframe plus the natural-remedies half.

## Why this is tractable

- **The drug half is mostly built.** `drug_labels` has FULLTEXT-searchable
  `indications`, and the indication search from #11 already answers "what treats
  X." Condition → OTC drugs reuses that machinery.
- **Both sides reduce to one pattern.** A natural remedy from a credible source
  is `name + uses-text + cautions + source`. FULLTEXT-search the remedy "uses"
  text for a condition exactly as we search drug `indications`. A condition page
  is then one query shape across two tables.
- **No new container.** Admin-app feature, same as Drug Reference / Workshop /
  Preparedness. Phase 2 adds one table (a migration); Phase 1 adds none.

## Data sources (licensing verified 2026-06-07)

- **Drugs:** existing `drug_labels` (openFDA, CC0). No change.
- **Natural remedies (primary):** **NCCIH "Herbs at a Glance"** — National
  Center for Complementary and Integrative Health (NIH). **Public domain**
  (US-government work; NCCIH explicitly states its publications are public domain
  and reproduction is encouraged, crediting NCCIH). ~50+ herb fact sheets, each
  with what-it-is, what-it's-used-for, and safety/side-effects + sources. Narrow
  breadth, but credible and safe — appropriate for an emergency-prep reference.
- **EXCLUDED — MedlinePlus Herbs & Supplements:** licensed third-party content
  (Therapeutic Research Center / Natural Medicines Comprehensive Database),
  copyrighted, and withdrawn from MedlinePlus as of 2025-07. Not usable. Noted
  here so it is not reconsidered.
- **Optional v2 depth — USDA Dr. Duke's Phytochemical & Ethnobotanical
  Databases:** public domain, but phytochemical (plant→chemical→activity), not
  consumer condition-use text. Deferred.
- Per-source licensing is re-verified at ingest time; only public-domain /
  open-license sources ship.

## Condition spine

A **curated** list of ~30–50 common first-aid / emergency situations (the
"small booklet" the #664 requester described), plus free-text condition search.
Stored as a versioned data file (JSON/TS constant, like
`collections/kiwix-categories.json` and the readiness sources), each entry:

```
{ slug, label, category, searchTerms: string[] }
```

`searchTerms` (synonyms — e.g. "pain": ["pain", "ache", "headache", "muscle
ache", "backache"]) drive the FULLTEXT queries against both `drug_labels.
indications` and (Phase 2) `natural_remedies.uses`. Curated = bounded, stable,
quality-controlled by us; no migration for the taxonomy. Free-text search also
works for conditions not on the list.

Indicative situations: pain, fever, allergic reaction, cough, congestion,
sore throat, nausea/vomiting, diarrhea, constipation, heartburn, wounds/cuts,
burns, insect bites/stings, sprains, dehydration, sleeplessness, skin
irritation/rash, eye irritation, motion sickness. (Final list curated in
Phase 1.)

## Phasing (working software each step)

### Phase 1 — condition-first DRUG browsing (no new data, no migration)

- Curated condition constant (above).
- `ConditionService.drugsFor(slug | freeText)` → FULLTEXT search of
  `drug_labels.indications` (+ searchable_name) using the condition's
  searchTerms; collapsed by brand+generic like the existing Drug Reference
  search; OTC-first ordering.
- Routes + Inertia pages: a condition index (browse the curated grid + search)
  and a condition detail page listing matching OTC drugs, each linking to its
  existing Drug Reference detail.
- Safety banner (see below).
- Gates: backend tsc 0 / inertia baseline / no new deps / **no migration**.

### Phase 2 — natural remedies (new table + ingest + two-column view)

- **Migration:** `natural_remedies` (id, name, slug, common_names, uses
  mediumtext, safety/cautions mediumtext, source, source_url, ingested_at;
  FULLTEXT on name+uses). Mirrors `drug_labels` shape.
- **Ingest:** an NCCIH "Herbs at a Glance" importer, download-from-source,
  memory-safe, cited (mirrors the Drug Reference openFDA ingest pattern:
  batched upsert on a stable key, status/progress UI, public-domain attribution
  stored per row). Re-runnable.
- `ConditionService.remediesFor(slug | freeText)` → FULLTEXT on
  `natural_remedies.uses` using the same condition searchTerms.
- Condition detail page becomes two columns: **OTC drugs | Natural remedies**,
  each row cited, each carrying its cautions; remedy rows link to a remedy
  detail page (uses + safety + NCCIH source link).
- Optional: deep-link the condition into offline ZIM content via the #15
  cross-reference (Hesperian / WikiMed), so a situation also points into the
  user's offline library.

## Safety framing (anchors both phases, prominent)

Stronger than Drug Reference's. On every condition and remedy view:
- Not medical advice; informational reference only.
- Drugs: openFDA labels, not an FDA endorsement, not a drug-interaction checker.
- Natural remedies: dietary supplements are **not** FDA-regulated the way drugs
  are; "natural" is not "safe"; herbs can interact with medications and
  conditions.
- In an emergency, contact a professional / emergency services.
This is a hard requirement, not a footnote — it gates ship.

## Architecture / components

- `admin/collections/conditions.json` (or a TS constant) — the curated spine.
- `admin/app/services/condition_service.ts` — `drugsFor` (P1), `remediesFor`
  (P2), `listConditions`.
- `admin/app/models/natural_remedy.ts` + migration (P2).
- `admin/app/jobs/ingest_nccih_remedies_job.ts` (P2) — the importer.
- `DrugReferenceController` / a new `ConditionsController` — `/conditions`,
  `/conditions/:slug`; JSON search endpoints.
- Inertia pages: `conditions/index.tsx`, `conditions/show.tsx`,
  `natural-remedies/show.tsx` (P2). Reuse Drug Reference card styles.
- Home/Preparedness entry point: a "When to use what" tile/link.

## Out of scope (now)

- MedlinePlus / any licensed remedy DB.
- USDA Duke's phytochemical depth (v2).
- LLM-generated remedy/condition mappings (FULLTEXT over curated public-domain
  text only — no model-authored medical claims).
- Dosing guidance / personalized recommendations (liability; the references
  state uses + cautions, not "take X mg").

## Testing

- Pure helpers (condition→searchTerms expansion; result collapse/ordering)
  unit-tested standalone (`node --experimental-strip-types`).
- Service tests with a seeded fixture for `drugsFor`/`remediesFor`.
- P2 ingest: the NCCIH parser tested on a saved sample fact sheet (offline,
  no network in tests).
- Gates per phase: backend tsc 0 / inertia baseline / no new deps; P1 no
  migration, P2 one migration (verify the table + FULLTEXT index applied).
- Operator mini-verify: browse "burn" → OTC drugs (P1) and herbs (P2) appear,
  cited, with cautions; free-text condition search works; safety banner present.
