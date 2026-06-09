---
feature: "When to use what" — Phase 2: natural/herbal remedies (NCCIH)
issue: caweis/project-nomad#16 (Phase 2); upstream Idea #664
decided_by: Chris (2026-06-09; supersedes the original Phase-2 "table + FULLTEXT" plan)
target_version: 0.2.7xx
status: approved — executing
tags: [drug-reference, natural-remedies, conditions, nccih, when-to-use-what, phase-2]
---

# Phase 2 — Natural / herbal remedies in the unified condition structure

## Goal
A condition (situation) search returns OTC **drugs AND natural remedies** together,
each cited and carrying safety cautions. Phase 1 shipped the drug half + the
condition spine; Phase 2 adds the natural-remedy half from NCCIH.

## Key decision — Option A (curated committed JSON, in-memory)
The original 2026-06-07 Phase-2 sketch assumed a `natural_remedies` table +
FULLTEXT. **Superseded.** For a ~15–25 item, hand-mapped, offline corpus a DB
table buys nothing (no scale, no fuzzy search needed) and adds a migration + a
second ingest pipeline right after the drug-ingest saga. Instead:

- **`collections/natural_remedies.json`** — curated, committed, versioned, exactly
  like `collections/conditions.json`. Served **in-memory** by `condition_service`.
- **No DB table, no migration, no runtime fetch.** Fits NOMAD's offline-first
  nature and the existing conditions.json pattern.

## Source (licensing verified)
**NCCIH "Herbs at a Glance"** (nccih.nih.gov/health/herbsataglance) — NIH /
US-government work, **public domain**, reproduction encouraged with credit. 60
herb fact sheets; we curate the subset that maps to our 36 acute/first-aid
conditions (ginger, peppermint, chamomile, valerian, lavender, echinacea,
elderberry, aloe vera, tea tree oil, turmeric, feverfew, passionflower, etc.).
Herbs that don't map to any condition (weight-loss/supplement herbs like garcinia,
hoodia, yohimbe) are **omitted** — condition-first means an unmapped herb never
surfaces. MedlinePlus Herbs remains EXCLUDED (licensed).

## Data shape — `collections/natural_remedies.json`
```jsonc
{
  "version": "2026-06-09",
  "source": { "name": "NCCIH — Herbs at a Glance", "url": "https://www.nccih.nih.gov/health/herbsataglance", "license": "Public domain (US government work; NCCIH)" },
  "remedies": [
    {
      "slug": "ginger",
      "name": "Ginger",
      "commonNames": ["Zingiber officinale"],
      "conditions": ["nausea-vomiting", "motion-sickness", "indigestion"],
      "uses": "Short plain-language summary of traditional/common use.",
      "evidence": "What the science says (NCCIH's evidence tone — often 'limited/mixed evidence').",
      "cautions": "Key safety notes, interactions, who should avoid.",
      "sourceUrl": "https://www.nccih.nih.gov/health/ginger"
    }
  ]
}
```
- `conditions[]` = **curated mapping** to our condition slugs (the join key).
- Mapping is conservative: only conditions NCCIH's "what it's used for" supports.

## Service integration (`condition_service`)
- Load `natural_remedies.json` once (module-level, like the conditions spine).
- `drugsForSlug(slug)` and `drugsForFreeText(query)` also return
  `remedies: NaturalRemedy[]` — the in-memory remedies whose `conditions[]`
  include the resolved slug (free-text resolves to condition(s) first; a remedy
  name/uses keyword match is a secondary fallback).
- DTO `ConditionDrugsResult` gains `remedies: NaturalRemedy[]`.
- Pure, O(remedies) filter — no DB, no SQL.

## Rendering (inline cards — no separate detail pages [YAGNI])
- In the condition results (conditions/show.tsx and the unified drug-reference
  surface), a distinct **"Natural remedies"** section below the OTC drugs.
- Each card: name, uses, key cautions, an NCCIH "learn more" link, and a clear
  caveat: *complementary; limited-evidence; not FDA-evaluated; talk to a
  clinician.* Visually separated from FDA drug cards so they're never read as
  equivalent.

## Safety
Every remedy card carries the evidence caveat. Remedies are never presented as
treatment-equivalent to drugs. Source + public-domain credit on the section.

## Testing
Pure helpers unit-tested with `node --experimental-strip-types`:
- `remediesForCondition(remedies, slug)` filter.
- free-text → condition resolution + remedy match.
- `natural_remedies.json` validates against the shape (required fields, known
  condition slugs only).

## Out of scope (this phase)
- Non-herbal "home remedies" (honey/cough, salt gargle, hydration) — deferred;
  needs its own public-domain-safe sourcing decision.
- Remedy detail pages.
- A DB table / migration.
