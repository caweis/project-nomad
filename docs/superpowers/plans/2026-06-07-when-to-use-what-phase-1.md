# "When to use what" — Condition-First Drug Browsing (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a NOMAD operator pick or search a first-aid situation (burn, fever, diarrhea…) and see the matching OTC drugs, each linking to its existing Drug Reference detail, under a strong safety banner — Phase 1 only (drugs; no natural remedies, no migration).

**Architecture:** A curated condition spine (root-level JSON, mirroring `collections/kiwix-categories.json`) drives FULLTEXT queries against `drug_labels.indications` by reusing the already-built `searchIndicationFulltext` machinery in `DrugReferenceService`. A new `ConditionService` loads + validates the spine, expands a condition's `searchTerms` into one OR-joined FULLTEXT query, and collapses/orders results OTC-first. A new `ConditionsController` renders two Inertia pages (`/conditions` index grid + free-text search, `/conditions/:slug` detail). Pure helpers (spine parsing, searchTerms→query expansion, OTC-first ordering) live in `admin/util/conditions.ts` and are unit-tested with `@japa/runner` exactly like `util/drug_labels.ts`.

**Tech Stack:** AdonisJS v6 (controllers/services), Lucid `db.rawQuery` (MySQL FULLTEXT), VineJS validators, Inertia + React + Tailwind (desert-* theme), `@tabler/icons-react` via `DynamicIcon`, `@japa/runner` tests.

---

## Key facts established from the existing code (do not re-derive)

- **FULLTEXT index already exists:** `ft_drug_labels_name_indications` over `(searchable_name, indications)` — migration `database/migrations/1778600000006_add_indications_fulltext_index.ts`. Phase 1 adds NO migration.
- **The query shape to reuse** is `DrugReferenceService.searchIndicationFulltext` (`admin/app/services/drug_reference_service.ts:179`). Note the LOAD-BEARING `MAX(MATCH(searchable_name, indications) AGAINST(? …)) AS relevance` — MySQL 8 `ONLY_FULL_GROUP_BY` rejects a bare `MATCH()` in SELECT under GROUP BY; wrapping in `MAX()` makes it an aggregate. Any new query MUST keep that pattern.
- **Curated data-file convention:** root `collections/*.json`, loaded by a service via `readFileSync(path.join(process.cwd(), ...))` or imported. We use a committed JSON file `collections/conditions.json` + a typed loader, matching the spec ("versioned data file … like `collections/kiwix-categories.json`").
- **Backend path aliases:** `#services/*`, `#controllers/*`, `#models/*`, `#validators/*`. Pure helpers in `admin/util/*.ts` import types via `../types/*.js`.
- **Inertia aliases:** `~/*` → `admin/inertia/*`; types imported relatively as `../../../types/<name>`.
- **Product type constant:** `PRODUCT_TYPES.OTC = 'HUMAN OTC DRUG'`, `PRODUCT_TYPES.RX = 'HUMAN PRESCRIPTION DRUG'` (`admin/types/drug_reference.ts`). OTC-first ordering keys off this.
- **Result row reuse:** `DrugSearchResult` DTO + `DrugResultRow` component already render brand/generic/OTC-Rx badge/route and link to `/drug-reference/:id`. Reuse both — do NOT fork a new row component.
- **Home tile registry:** `admin/inertia/pages/home.tsx` — Drug Reference `displayOrder: 6`, Preparedness `displayOrder: 7`. The new "When to use what" tile slots at `displayOrder: 6.5` style (insert between; renumber is unnecessary because sort is numeric).
- **Tests:** `@japa/runner`, `test.group(...)`, `({ assert }) => assert.equal(...)`. Files: `admin/tests/unit/<name>.spec.ts`. Run with `node ace test` (from `admin/`). Pure-helper standalone variants optional in `admin/tests/standalone/`.
- **Gates (per spec):** backend `tsc --noEmit` 0 errors / inertia builds / no new deps / **no migration**.

---

## File Structure

**Create:**
- `collections/conditions.json` — the curated condition spine (~30–50 entries), root-level versioned data file.
- `admin/types/conditions.ts` — `Condition`, `ConditionSummary`, `ConditionDrugsResult` DTOs (one concern: condition feature types).
- `admin/util/conditions.ts` — pure helpers: `parseConditionsFile`, `buildIndicationQuery`, `orderOtcFirst`, `findConditionBySlug`. No Lucid/HTTP imports.
- `admin/app/services/condition_service.ts` — `ConditionService` (`listConditions`, `findCondition`, `drugsFor`).
- `admin/app/controllers/conditions_controller.ts` — `ConditionsController` (`index`, `show`, `drugsApi`).
- `admin/app/validators/conditions.ts` — `conditionSearchValidator` (free-text q) + `conditionDrugsValidator` (slug/freeText + paging).
- `admin/inertia/pages/conditions/index.tsx` — browse curated grid + free-text condition search.
- `admin/inertia/pages/conditions/show.tsx` — condition detail: matching OTC drugs + safety banner.
- `admin/inertia/components/conditions/SafetyBanner.tsx` — the strong, reusable safety banner (used on index + show).
- `admin/inertia/components/conditions/ConditionCard.tsx` — one curated-condition tile for the index grid.
- `admin/tests/unit/conditions.spec.ts` — unit tests for the pure helpers.

**Modify:**
- `admin/start/routes.ts` — register `/conditions`, `/conditions/:slug`, `/api/conditions/*`.
- `admin/inertia/pages/home.tsx` — add the "When to use what" home tile.
- `admin/inertia/pages/drug-reference/index.tsx` — add a small "Browse by situation →" link to `/conditions` (cross-entry, mirrors the existing "Compare interactions" Link button).

---

## Task 1: Condition types

**Files:**
- Create: `admin/types/conditions.ts`

- [ ] **Step 1: Write the types file**

```ts
/**
 * "When to use what" — condition-first reference types (Phase 1).
 *
 * The curated condition spine + the DTOs returned to the client. Phase 1 covers
 * drugs only; remedy fields are deliberately absent until Phase 2.
 */

// ─── Curated spine entry (from collections/conditions.json) ──────────────────

/**
 * One curated first-aid / emergency situation. `searchTerms` are the synonyms
 * OR-expanded into the FULLTEXT query against drug_labels.indications.
 */
export interface Condition {
  slug: string
  label: string
  category: string
  searchTerms: string[]
}

/** The versioned spine file shape. `version` bumps when the curation changes. */
export interface ConditionsFile {
  version: number
  conditions: Condition[]
}

// ─── Client DTOs ─────────────────────────────────────────────────────────────

/** Slim condition for the index grid (no searchTerms — internal only). */
export interface ConditionSummary {
  slug: string
  label: string
  category: string
}

/**
 * The /conditions/:slug payload: the resolved condition + its matching OTC-first
 * drug results (reusing the existing DrugSearchResult collapsed shape).
 */
import type { DrugSearchResult } from './drug_reference.js'

export interface ConditionDrugsResult {
  condition: ConditionSummary
  drugs: DrugSearchResult[]
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin && npm run typecheck`
Expected: 0 errors (no consumers yet, but the file must compile).

- [ ] **Step 3: Commit**

```bash
git add admin/types/conditions.ts
git commit -m "feat(conditions): add Phase 1 condition types"
```

---

## Task 2: Curated condition spine (data file)

**Files:**
- Create: `collections/conditions.json`

- [ ] **Step 1: Write the spine file**

~30–50 curated first-aid situations. Each `searchTerms` array is OR-expanded into the FULLTEXT query, so include common label-language synonyms. Categories group the index grid. (List below is the curated Phase 1 set — derived from the spec's indicative list, expanded to ~36.)

```json
{
  "version": 1,
  "conditions": [
    { "slug": "pain", "label": "Pain", "category": "Pain & Fever", "searchTerms": ["pain", "ache", "aches", "minor pain", "muscle ache", "backache", "body ache"] },
    { "slug": "headache", "label": "Headache", "category": "Pain & Fever", "searchTerms": ["headache", "head pain", "tension headache", "migraine"] },
    { "slug": "fever", "label": "Fever", "category": "Pain & Fever", "searchTerms": ["fever", "reduces fever", "fever reducer", "temperature"] },
    { "slug": "toothache", "label": "Toothache", "category": "Pain & Fever", "searchTerms": ["toothache", "tooth pain", "dental pain", "gum pain"] },
    { "slug": "menstrual-cramps", "label": "Menstrual cramps", "category": "Pain & Fever", "searchTerms": ["menstrual cramps", "menstrual pain", "period pain", "premenstrual"] },
    { "slug": "muscle-joint-pain", "label": "Muscle & joint pain", "category": "Pain & Fever", "searchTerms": ["muscle pain", "joint pain", "arthritis", "muscular aches", "sprain pain"] },

    { "slug": "allergic-reaction", "label": "Allergic reaction", "category": "Allergy & Cold", "searchTerms": ["allergic reaction", "allergy", "allergies", "hay fever", "hives", "allergic rhinitis"] },
    { "slug": "runny-nose", "label": "Runny nose & sneezing", "category": "Allergy & Cold", "searchTerms": ["runny nose", "sneezing", "rhinitis", "itchy nose"] },
    { "slug": "cough", "label": "Cough", "category": "Allergy & Cold", "searchTerms": ["cough", "coughing", "cough suppressant", "chest congestion"] },
    { "slug": "congestion", "label": "Nasal congestion", "category": "Allergy & Cold", "searchTerms": ["nasal congestion", "stuffy nose", "sinus congestion", "decongestant"] },
    { "slug": "sore-throat", "label": "Sore throat", "category": "Allergy & Cold", "searchTerms": ["sore throat", "throat pain", "pharyngitis", "minor sore throat"] },
    { "slug": "cold-flu", "label": "Cold & flu symptoms", "category": "Allergy & Cold", "searchTerms": ["common cold", "flu", "influenza", "cold symptoms"] },

    { "slug": "nausea-vomiting", "label": "Nausea & vomiting", "category": "Stomach & Digestion", "searchTerms": ["nausea", "vomiting", "upset stomach", "queasiness"] },
    { "slug": "diarrhea", "label": "Diarrhea", "category": "Stomach & Digestion", "searchTerms": ["diarrhea", "loose stools", "antidiarrheal"] },
    { "slug": "constipation", "label": "Constipation", "category": "Stomach & Digestion", "searchTerms": ["constipation", "laxative", "irregularity", "stool softener"] },
    { "slug": "heartburn", "label": "Heartburn & acid reflux", "category": "Stomach & Digestion", "searchTerms": ["heartburn", "acid indigestion", "acid reflux", "sour stomach", "gerd"] },
    { "slug": "gas-bloating", "label": "Gas & bloating", "category": "Stomach & Digestion", "searchTerms": ["gas", "bloating", "flatulence", "antiflatulent"] },
    { "slug": "indigestion", "label": "Indigestion & upset stomach", "category": "Stomach & Digestion", "searchTerms": ["indigestion", "upset stomach", "dyspepsia", "stomach upset"] },

    { "slug": "wounds-cuts", "label": "Wounds & cuts", "category": "Skin & Wounds", "searchTerms": ["minor cuts", "wound", "scrapes", "abrasions", "first aid antiseptic"] },
    { "slug": "burns", "label": "Burns", "category": "Skin & Wounds", "searchTerms": ["minor burns", "burn", "sunburn", "burn relief"] },
    { "slug": "insect-bites", "label": "Insect bites & stings", "category": "Skin & Wounds", "searchTerms": ["insect bites", "stings", "bug bites", "itching from bites"] },
    { "slug": "skin-rash", "label": "Skin irritation & rash", "category": "Skin & Wounds", "searchTerms": ["skin irritation", "rash", "itching", "dermatitis", "poison ivy"] },
    { "slug": "fungal-infection", "label": "Athlete's foot & fungal", "category": "Skin & Wounds", "searchTerms": ["athletes foot", "ringworm", "jock itch", "antifungal", "fungal infection"] },
    { "slug": "dry-skin", "label": "Dry or chapped skin", "category": "Skin & Wounds", "searchTerms": ["dry skin", "chapped skin", "moisturizer", "skin protectant"] },
    { "slug": "acne", "label": "Acne", "category": "Skin & Wounds", "searchTerms": ["acne", "pimples", "blemishes", "acne treatment"] },

    { "slug": "sprains", "label": "Sprains & strains", "category": "Injury & Strain", "searchTerms": ["sprain", "strain", "minor muscle pain", "muscular injury"] },
    { "slug": "swelling", "label": "Swelling & inflammation", "category": "Injury & Strain", "searchTerms": ["swelling", "inflammation", "anti-inflammatory"] },

    { "slug": "dehydration", "label": "Dehydration", "category": "Hydration & Energy", "searchTerms": ["dehydration", "electrolyte", "oral rehydration", "fluid loss"] },

    { "slug": "sleeplessness", "label": "Sleeplessness", "category": "Sleep & Calm", "searchTerms": ["sleeplessness", "insomnia", "trouble sleeping", "nighttime sleep aid"] },
    { "slug": "motion-sickness", "label": "Motion sickness", "category": "Sleep & Calm", "searchTerms": ["motion sickness", "travel sickness", "seasickness", "nausea from motion"] },

    { "slug": "eye-irritation", "label": "Eye irritation", "category": "Eyes, Ears & Mouth", "searchTerms": ["eye irritation", "dry eyes", "red eyes", "itchy eyes", "eye drops"] },
    { "slug": "earache", "label": "Earache & ear wax", "category": "Eyes, Ears & Mouth", "searchTerms": ["earache", "ear pain", "ear wax", "earwax removal"] },
    { "slug": "canker-cold-sores", "label": "Canker & cold sores", "category": "Eyes, Ears & Mouth", "searchTerms": ["canker sore", "cold sore", "mouth sore", "fever blister"] },

    { "slug": "hemorrhoids", "label": "Hemorrhoids", "category": "Other", "searchTerms": ["hemorrhoids", "anal itching", "hemorrhoidal"] },
    { "slug": "minor-eye-allergy", "label": "Itchy, watery eyes (allergy)", "category": "Other", "searchTerms": ["itchy watery eyes", "ocular allergy", "allergic conjunctivitis"] }
  ]
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('collections/conditions.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add collections/conditions.json
git commit -m "feat(conditions): add curated Phase 1 condition spine"
```

---

## Task 3: Pure helpers (`util/conditions.ts`) — TDD

**Files:**
- Create: `admin/util/conditions.ts`
- Test: `admin/tests/unit/conditions.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from '@japa/runner'
import {
  parseConditionsFile,
  buildIndicationQuery,
  orderOtcFirst,
  findConditionBySlug,
} from '../../util/conditions.js'
import type { Condition } from '../../types/conditions.js'
import { PRODUCT_TYPES } from '../../types/drug_reference.js'

const SAMPLE: Condition[] = [
  { slug: 'burns', label: 'Burns', category: 'Skin & Wounds', searchTerms: ['minor burns', 'sunburn'] },
  { slug: 'fever', label: 'Fever', category: 'Pain & Fever', searchTerms: ['fever'] },
]

test.group('parseConditionsFile', () => {
  test('parses a valid file into conditions', ({ assert }) => {
    const file = JSON.stringify({ version: 1, conditions: SAMPLE })
    const result = parseConditionsFile(file)
    assert.lengthOf(result, 2)
    assert.equal(result[0].slug, 'burns')
  })

  test('returns [] for malformed JSON', ({ assert }) => {
    assert.deepEqual(parseConditionsFile('{ not json'), [])
  })

  test('drops entries missing required fields', ({ assert }) => {
    const file = JSON.stringify({
      version: 1,
      conditions: [{ slug: 'x', label: 'X' }, SAMPLE[0]],
    })
    const result = parseConditionsFile(file)
    assert.lengthOf(result, 1)
    assert.equal(result[0].slug, 'burns')
  })
})

test.group('buildIndicationQuery', () => {
  test('joins multi-word terms as quoted phrases for NATURAL LANGUAGE mode', ({ assert }) => {
    const q = buildIndicationQuery(['minor burns', 'sunburn'])
    assert.equal(q, '"minor burns" sunburn')
  })

  test('returns empty string for no terms', ({ assert }) => {
    assert.equal(buildIndicationQuery([]), '')
  })
})

test.group('orderOtcFirst', () => {
  test('OTC rows sort before Rx and unknown, stable within group', ({ assert }) => {
    const rows = [
      { id: 1, brand_name: 'A', generic_name: null, manufacturer: null, route: null, product_type: PRODUCT_TYPES.RX, labelCount: 1 },
      { id: 2, brand_name: 'B', generic_name: null, manufacturer: null, route: null, product_type: PRODUCT_TYPES.OTC, labelCount: 1 },
      { id: 3, brand_name: 'C', generic_name: null, manufacturer: null, route: null, product_type: null, labelCount: 1 },
    ]
    const ordered = orderOtcFirst(rows)
    assert.deepEqual(ordered.map((r) => r.id), [2, 1, 3])
  })
})

test.group('findConditionBySlug', () => {
  test('finds by slug, null when absent', ({ assert }) => {
    assert.equal(findConditionBySlug(SAMPLE, 'fever')?.label, 'Fever')
    assert.isNull(findConditionBySlug(SAMPLE, 'nope'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && node ace test --files=conditions.spec.ts`
Expected: FAIL — cannot find module `../../util/conditions.js`.

- [ ] **Step 3: Write the helper**

```ts
/**
 * "When to use what" — pure, unit-testable helpers (Phase 1).
 *
 * NO Lucid / AdonisJS / HTTP imports. Mirrors util/drug_labels.ts so these run
 * under @japa/runner without booting MySQL or Redis.
 */
import type { Condition } from '../types/conditions.js'
import type { DrugSearchResult } from '../types/drug_reference.js'
import { PRODUCT_TYPES } from '../types/drug_reference.js'

/**
 * Parse + validate the conditions spine file body. Returns only well-formed
 * entries (slug + label + category + non-empty searchTerms[]); returns [] on
 * malformed JSON or wrong shape. Fail-soft so a bad data file degrades the
 * feature to "free-text only" rather than crashing the page.
 */
export function parseConditionsFile(body: string): Condition[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  const list = (parsed as { conditions?: unknown })?.conditions
  if (!Array.isArray(list)) return []
  const out: Condition[] = []
  for (const raw of list) {
    const c = raw as Partial<Condition>
    if (
      typeof c.slug === 'string' &&
      typeof c.label === 'string' &&
      typeof c.category === 'string' &&
      Array.isArray(c.searchTerms) &&
      c.searchTerms.length > 0 &&
      c.searchTerms.every((t) => typeof t === 'string')
    ) {
      out.push({ slug: c.slug, label: c.label, category: c.category, searchTerms: c.searchTerms })
    }
  }
  return out
}

/**
 * Build the AGAINST(...) string for MySQL NATURAL LANGUAGE MODE from a term
 * list. Multi-word terms are wrapped in double quotes so they match as phrases;
 * single words are passed bare. The result is OR-ish relevance ranking — every
 * term contributes, phrase terms only match contiguously.
 */
export function buildIndicationQuery(terms: string[]): string {
  return terms
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.includes(' ') ? `"${t}"` : t))
    .join(' ')
}

/**
 * Stable OTC-first ordering. OTC rows first, then Rx, then unknown/other,
 * preserving the incoming (relevance) order within each group.
 */
export function orderOtcFirst(rows: DrugSearchResult[]): DrugSearchResult[] {
  const rank = (pt: string | null): number => {
    if (pt === PRODUCT_TYPES.OTC) return 0
    if (pt === PRODUCT_TYPES.RX) return 1
    return 2
  }
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row.product_type) - rank(b.row.product_type) || a.i - b.i)
    .map((x) => x.row)
}

/** Find a curated condition by slug; null when absent. */
export function findConditionBySlug(conditions: Condition[], slug: string): Condition | null {
  return conditions.find((c) => c.slug === slug) ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && node ace test --files=conditions.spec.ts`
Expected: PASS (all groups green).

- [ ] **Step 5: Commit**

```bash
git add admin/util/conditions.ts admin/tests/unit/conditions.spec.ts
git commit -m "feat(conditions): pure helpers for spine parse + query + OTC-first ordering"
```

---

## Task 4: ConditionService

**Files:**
- Create: `admin/app/services/condition_service.ts`

- [ ] **Step 1: Write the service**

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { normalizeDrugName } from '../../util/drug_labels.js'
import {
  parseConditionsFile,
  buildIndicationQuery,
  orderOtcFirst,
  findConditionBySlug,
} from '../../util/conditions.js'
import type { Condition, ConditionSummary } from '../../types/conditions.js'
import type { DrugSearchResult } from '../../types/drug_reference.js'

/**
 * "When to use what" — Phase 1 service.
 *
 * Loads the curated condition spine (collections/conditions.json) and answers
 * "what OTC drugs treat this situation" by FULLTEXT-searching
 * drug_labels.indications with the condition's searchTerms. Reuses the exact
 * ft_drug_labels_name_indications index + MAX(MATCH …) GROUP-BY pattern that
 * DrugReferenceService.searchIndicationFulltext established.
 */
export class ConditionService {
  // Resolve from repo root: admin/ is process.cwd() in the running app; the
  // spine lives one level up at collections/conditions.json.
  private readonly spineFile = path.join(process.cwd(), '..', 'collections', 'conditions.json')

  private cache: Condition[] | null = null

  /** Load + cache the curated spine. Fail-soft to [] (free-text still works). */
  private async loadConditions(): Promise<Condition[]> {
    if (this.cache) return this.cache
    try {
      const body = await readFile(this.spineFile, 'utf8')
      this.cache = parseConditionsFile(body)
    } catch (err) {
      logger.warn(
        `[ConditionService] could not read conditions spine: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      this.cache = []
    }
    return this.cache
  }

  /** All curated conditions as slim summaries (no searchTerms) for the index. */
  async listConditions(): Promise<ConditionSummary[]> {
    const conditions = await this.loadConditions()
    return conditions.map(({ slug, label, category }) => ({ slug, label, category }))
  }

  /** Resolve one curated condition's summary by slug; null when absent. */
  async findCondition(slug: string): Promise<ConditionSummary | null> {
    const conditions = await this.loadConditions()
    const c = findConditionBySlug(conditions, slug)
    return c ? { slug: c.slug, label: c.label, category: c.category } : null
  }

  /**
   * OTC drugs for a curated condition slug. Returns null when the slug isn't in
   * the spine (controller → 404). Empty drugs[] is valid (no labels matched).
   */
  async drugsForSlug(slug: string, limit = 100): Promise<DrugSearchResult[] | null> {
    const conditions = await this.loadConditions()
    const condition = findConditionBySlug(conditions, slug)
    if (!condition) return null
    const query = buildIndicationQuery(condition.searchTerms)
    return this.searchIndications(query, limit)
  }

  /** OTC drugs for an arbitrary free-text condition (off-list). */
  async drugsForFreeText(freeText: string, limit = 100): Promise<DrugSearchResult[]> {
    const query = buildIndicationQuery([freeText])
    return this.searchIndications(query, limit)
  }

  /**
   * Run the FULLTEXT indication search, collapse by brand+generic, and return
   * OTC-first. Mirrors DrugReferenceService.searchIndicationFulltext; the
   * MAX(MATCH …) wrapper is load-bearing for ONLY_FULL_GROUP_BY.
   */
  private async searchIndications(rawQuery: string, limit: number): Promise<DrugSearchResult[]> {
    const normalized = (normalizeDrugName(rawQuery, null) ?? rawQuery).trim()
    if (!normalized) return []

    try {
      const sql = `
        SELECT
          MIN(id) AS id,
          brand_name,
          generic_name,
          MIN(manufacturer) AS manufacturer,
          MIN(route) AS route,
          MIN(product_type) AS product_type,
          COUNT(*) AS labelCount,
          MAX(MATCH(searchable_name, indications) AGAINST(? IN NATURAL LANGUAGE MODE)) AS relevance
        FROM drug_labels
        WHERE MATCH(searchable_name, indications) AGAINST(? IN NATURAL LANGUAGE MODE)
        GROUP BY brand_name, generic_name
        ORDER BY relevance DESC
        LIMIT ?
      `
      const rows = await db.rawQuery(sql, [normalized, normalized, limit])
      return orderOtcFirst(this.mapRows(rows[0]))
    } catch (err) {
      logger.warn(
        `[ConditionService] FULLTEXT indication search failed, falling back to LIKE: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      const term = `%${normalized}%`
      const sql = `
        SELECT
          MIN(id) AS id,
          brand_name,
          generic_name,
          MIN(manufacturer) AS manufacturer,
          MIN(route) AS route,
          MIN(product_type) AS product_type,
          COUNT(*) AS labelCount
        FROM drug_labels
        WHERE indications LIKE ?
        GROUP BY brand_name, generic_name
        ORDER BY brand_name ASC
        LIMIT ?
      `
      const rows = await db.rawQuery(sql, [term, limit])
      return orderOtcFirst(this.mapRows(rows[0]))
    }
  }

  private mapRows(rows: any[]): DrugSearchResult[] {
    if (!Array.isArray(rows)) return []
    return rows.map((row) => ({
      id: Number(row.id),
      brand_name: row.brand_name ?? null,
      generic_name: row.generic_name ?? null,
      manufacturer: row.manufacturer ?? null,
      route: row.route ?? null,
      product_type: row.product_type ?? null,
      labelCount: Number(row.labelCount ?? row.labelcount ?? 1),
    }))
  }

  /** Live drug_labels row count — drives the empty-state prompt. */
  async drugRowCount(): Promise<number> {
    try {
      const result = await db.rawQuery('SELECT COUNT(*) AS cnt FROM drug_labels')
      const rows = result[0] as Array<{ cnt: number | string }>
      return Number(rows[0]?.cnt ?? 0)
    } catch {
      return 0
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add admin/app/services/condition_service.ts
git commit -m "feat(conditions): ConditionService.drugsFor over drug_labels.indications"
```

---

## Task 5: Validators

**Files:**
- Create: `admin/app/validators/conditions.ts`

- [ ] **Step 1: Write the validators**

```ts
import vine from '@vinejs/vine'

/**
 * "When to use what" — request validators (Phase 1).
 *
 * Mirrors drug_reference validators: vine, minimal, typed at the edge.
 */

/** GET /api/conditions/drugs?slug=burns  OR  ?q=free text */
export const conditionDrugsValidator = vine.compile(
  vine.object({
    slug: vine.string().trim().minLength(1).maxLength(120).optional(),
    q: vine.string().trim().minLength(1).maxLength(200).optional(),
    limit: vine.number().min(1).max(200).optional(),
  })
)
```

- [ ] **Step 2: Typecheck**

Run: `cd admin && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add admin/app/validators/conditions.ts
git commit -m "feat(conditions): request validators"
```

---

## Task 6: ConditionsController

**Files:**
- Create: `admin/app/controllers/conditions_controller.ts`

- [ ] **Step 1: Write the controller**

```ts
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { ConditionService } from '#services/condition_service'
import { conditionDrugsValidator } from '#validators/conditions'

/**
 * "When to use what" — HTTP boundary (Phase 1).
 *
 * Two Inertia pages (index / show) + one JSON action (drugs). Mirrors
 * DrugReferenceController: integer/slug guards, never leak exceptions, JSON
 * actions return plain objects.
 */
export default class ConditionsController {
  private get service() {
    return new ConditionService()
  }

  /** GET /conditions — curated grid + free-text condition search. */
  async index({ inertia }: HttpContext) {
    try {
      const [conditions, drugRowCount] = await Promise.all([
        this.service.listConditions(),
        this.service.drugRowCount(),
      ])
      return inertia.render('conditions/index', { conditions, drugRowCount })
    } catch (err) {
      logger.error(
        `[ConditionsController] index failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return inertia.render('conditions/index', { conditions: [], drugRowCount: 0 })
    }
  }

  /** GET /conditions/:slug — detail: matching OTC-first drugs + safety banner. */
  async show({ inertia, params, response }: HttpContext) {
    const slug = String(params.slug ?? '').trim()
    if (!slug) return response.notFound({ error: 'invalid slug' })

    try {
      const condition = await this.service.findCondition(slug)
      if (!condition) return response.notFound({ error: 'Condition not found' })

      const drugs = (await this.service.drugsForSlug(slug)) ?? []
      const drugRowCount = await this.service.drugRowCount()
      return inertia.render('conditions/show', { condition, drugs, drugRowCount })
    } catch (err) {
      logger.error(
        `[ConditionsController] show(${slug}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      return response.internalServerError({ error: 'Could not load condition' })
    }
  }

  /** GET /api/conditions/drugs?slug=… | ?q=… — free-text / async drug results. */
  async drugsApi({ request, response }: HttpContext) {
    try {
      const params = await request.validateUsing(conditionDrugsValidator)
      if (params.slug) {
        const drugs = await this.service.drugsForSlug(params.slug, params.limit)
        if (drugs === null) return response.notFound({ error: 'Condition not found' })
        return { drugs }
      }
      if (params.q) {
        const drugs = await this.service.drugsForFreeText(params.q, params.limit)
        return { drugs }
      }
      return response.badRequest({ error: 'slug or q required' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`[ConditionsController] drugsApi failed: ${msg}`)
      return response.badRequest({ error: msg })
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add admin/app/controllers/conditions_controller.ts
git commit -m "feat(conditions): ConditionsController (index/show/drugsApi)"
```

---

## Task 7: Routes

**Files:**
- Modify: `admin/start/routes.ts`

- [ ] **Step 1: Add the controller import**

After the `import DrugReferenceController …` line (currently `admin/start/routes.ts:27`), add:

```ts
import ConditionsController from '#controllers/conditions_controller'
```

- [ ] **Step 2: Add the routes**

Immediately after the `/api/drug-reference` group block (currently ends `admin/start/routes.ts:86`), add:

```ts
// "When to use what" — condition-first drug browsing (Phase 1).
// Page GETs ungated (read-only views), mirroring /drug-reference. The literal
// /conditions index has no param collision with /conditions/:slug, but keep the
// index registration first for readability.
router.get('/conditions', [ConditionsController, 'index'])
router.get('/conditions/:slug', [ConditionsController, 'show'])
router
  .group(() => {
    router.get('/drugs', [ConditionsController, 'drugsApi'])
  })
  .prefix('/api/conditions')
```

- [ ] **Step 3: Typecheck + verify routes**

Run: `cd admin && npm run typecheck && node ace list:routes | grep conditions`
Expected: 0 errors; three rows: `GET /conditions`, `GET /conditions/:slug`, `GET /api/conditions/drugs`.

- [ ] **Step 4: Commit**

```bash
git add admin/start/routes.ts
git commit -m "feat(conditions): register /conditions routes"
```

---

## Task 8: SafetyBanner component

**Files:**
- Create: `admin/inertia/components/conditions/SafetyBanner.tsx`

- [ ] **Step 1: Write the component**

Strong banner (spec: "hard requirement, not a footnote — it gates ship"). Uses the existing red/amber callout style + a Tabler alert icon, matching `drug-reference/show.tsx`'s boxed-warning treatment.

```tsx
import { IconAlertTriangle } from '@tabler/icons-react'

/**
 * "When to use what" — the safety banner that gates ship.
 *
 * Stronger than Drug Reference's footer: shown prominently at the TOP of every
 * condition view. Phase 1 covers drugs only, so the natural-remedies caution is
 * deferred to Phase 2.
 */
export default function SafetyBanner() {
  return (
    <section
      role="note"
      aria-label="Safety information"
      className="mb-6 border-2 border-amber-500 rounded-lg p-4 bg-amber-50"
    >
      <div className="flex items-center gap-2 mb-2">
        <IconAlertTriangle size={20} className="text-amber-600 flex-shrink-0" />
        <h2 className="text-base font-bold text-amber-800 uppercase tracking-wide">
          Read before using
        </h2>
      </div>
      <ul className="text-sm text-amber-900 space-y-1 list-disc pl-5">
        <li>This is an informational reference, <strong>not medical advice</strong>.</li>
        <li>
          Drug results come from public-domain openFDA labels — listing a drug here is{' '}
          <strong>not an FDA endorsement</strong>, and this is <strong>not a drug-interaction
          checker</strong>.
        </li>
        <li>
          In an emergency, contact a medical professional or your local emergency services
          immediately.
        </li>
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/inertia/components/conditions/SafetyBanner.tsx
git commit -m "feat(conditions): SafetyBanner component"
```

---

## Task 9: ConditionCard component

**Files:**
- Create: `admin/inertia/components/conditions/ConditionCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Link } from '@inertiajs/react'
import type { ConditionSummary } from '../../../types/conditions'

interface Props {
  condition: ConditionSummary
}

/** One curated-condition tile for the /conditions index grid. */
export default function ConditionCard({ condition }: Props) {
  return (
    <Link
      href={`/conditions/${condition.slug}`}
      className="flex flex-col rounded-lg border border-gray-200 p-3 hover:border-desert-green hover:bg-gray-50 transition-colors group"
    >
      <span className="font-semibold text-sm text-gray-900 group-hover:text-desert-green">
        {condition.label}
      </span>
      <span className="mt-0.5 text-xs text-gray-500">{condition.category}</span>
    </Link>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/inertia/components/conditions/ConditionCard.tsx
git commit -m "feat(conditions): ConditionCard grid tile"
```

---

## Task 10: Conditions index page

**Files:**
- Create: `admin/inertia/pages/conditions/index.tsx`

- [ ] **Step 1: Write the page**

Browse the curated grid (grouped by category) + free-text condition search that hits `/api/conditions/drugs?q=…` and renders reused `DrugResultRow`s. Empty-state mirrors drug-reference when `drugRowCount === 0`.

```tsx
import { useState, useRef, useCallback } from 'react'
import { Head, Link } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import SafetyBanner from '~/components/conditions/SafetyBanner'
import ConditionCard from '~/components/conditions/ConditionCard'
import DrugResultRow from '~/components/drug-reference/DrugResultRow'
import type { ConditionSummary } from '../../../types/conditions'
import type { DrugSearchResult } from '../../../types/drug_reference'

interface PageProps {
  conditions: ConditionSummary[]
  drugRowCount: number
}

const DEBOUNCE_MS = 350

/**
 * "When to use what" index. Curated situation grid (grouped by category) plus a
 * free-text condition search ("what should I use for …") that lists matching
 * OTC-first drugs inline.
 */
export default function ConditionsIndex({ conditions, drugRowCount }: PageProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DrugSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEmpty = drugRowCount === 0

  // Group curated conditions by category, preserving first-seen order.
  const grouped: { category: string; items: ConditionSummary[] }[] = []
  for (const c of conditions) {
    let g = grouped.find((x) => x.category === c.category)
    if (!g) {
      g = { category: c.category, items: [] }
      grouped.push(g)
    }
    g.items.push(c)
  }

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`/api/conditions/drugs?q=${encodeURIComponent(q)}`)
      if (!resp.ok) throw new Error(`Search failed: HTTP ${resp.status}`)
      const json = (await resp.json()) as { drugs: DrugSearchResult[] }
      setResults(json.drugs ?? [])
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), DEBOUNCE_MS)
  }

  return (
    <AppLayout>
      <Head title="When to use what" />

      <div className="p-4 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">When to use what</h1>
          <p className="text-sm opacity-70">
            Pick a situation to see which over-the-counter drugs may help — or search for
            any condition.
          </p>
        </div>

        <SafetyBanner />

        {isEmpty ? (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <p className="text-lg font-semibold mb-2">No drug data yet</p>
            <p className="mb-6 opacity-70">
              This feature searches the offline FDA drug labels. Download that dataset from
              Drug Reference to enable situation browsing.
            </p>
            <Link href="/drug-reference">
              <StyledButton variant="primary" onClick={() => {}}>
                Go to Drug Reference
              </StyledButton>
            </Link>
          </div>
        ) : (
          <>
            {/* Free-text condition search */}
            <div className="mb-6">
              <input
                type="text"
                value={query}
                onChange={handleQueryChange}
                placeholder="Search a condition — e.g. burn, fever, diarrhea, bee sting"
                className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-desert-green"
              />
            </div>

            {error && (
              <div className="text-red-600 text-sm mb-4 p-3 bg-red-50 rounded">{error}</div>
            )}

            {query.trim() ? (
              <>
                {loading && results.length === 0 && (
                  <div className="text-center py-8 opacity-60">Searching…</div>
                )}
                {searched && results.length === 0 && !loading && (
                  <div className="text-center py-8 opacity-60">No OTC drugs matched "{query}"</div>
                )}
                {results.length > 0 && (
                  <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden mb-6">
                    {results.map((r) => (
                      <DrugResultRow key={r.id} result={r} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              // Curated grid, grouped by category
              <div className="space-y-6">
                {grouped.map((group) => (
                  <div key={group.category}>
                    <h2 className="text-sm font-bold text-gray-700 mb-2">{group.category}</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {group.items.map((c) => (
                        <ConditionCard key={c.slug} condition={c} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
          <strong>Source:</strong> U.S. Food &amp; Drug Administration drug labeling, via{' '}
          <strong>openFDA</strong> — public domain (CC0 1.0). NOMAD is not affiliated with or
          endorsed by the FDA. Do not rely on this data for medical decisions.
        </footer>
      </div>
    </AppLayout>
  )
}
```

- [ ] **Step 2: Build inertia to verify it compiles**

Run: `cd admin && npm run build` (or the inertia/vite build script — confirm the exact name from `admin/package.json` `scripts`).
Expected: build succeeds, no TS/JSX errors referencing `conditions/index`.

- [ ] **Step 3: Commit**

```bash
git add admin/inertia/pages/conditions/index.tsx
git commit -m "feat(conditions): index page (curated grid + free-text search)"
```

---

## Task 11: Conditions detail page

**Files:**
- Create: `admin/inertia/pages/conditions/show.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { Head, Link } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import { IconArrowLeft } from '@tabler/icons-react'
import SafetyBanner from '~/components/conditions/SafetyBanner'
import DrugResultRow from '~/components/drug-reference/DrugResultRow'
import type { ConditionSummary } from '../../../types/conditions'
import type { DrugSearchResult } from '../../../types/drug_reference'

interface PageProps {
  condition: ConditionSummary
  drugs: DrugSearchResult[]
  drugRowCount: number
}

/**
 * "When to use what" detail. One situation → its matching OTC-first drugs, each
 * row linking to the existing Drug Reference detail page. Safety banner up top.
 */
export default function ConditionsShow({ condition, drugs }: PageProps) {
  return (
    <AppLayout>
      <Head title={`${condition.label} — When to use what`} />

      <div className="p-4 max-w-3xl mx-auto">
        <div className="mb-4">
          <Link
            href="/conditions"
            className="inline-flex items-center gap-1 text-sm text-desert-green hover:underline"
          >
            <IconArrowLeft size={16} />
            When to use what
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">{condition.label}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{condition.category}</p>
        </div>

        <SafetyBanner />

        <section>
          <h2 className="text-base font-bold mb-2 border-b border-gray-200 pb-1">
            Over-the-counter drugs
          </h2>
          {drugs.length === 0 ? (
            <p className="text-sm opacity-60 py-4">
              No drug labels matched this situation in the offline dataset.
            </p>
          ) : (
            <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
              {drugs.map((r) => (
                <DrugResultRow key={r.id} result={r} />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
          <strong>Source:</strong> U.S. Food &amp; Drug Administration drug labeling, via{' '}
          <strong>openFDA</strong> — public domain (CC0 1.0). Matches are by label indication text
          and may be incomplete. Not an FDA endorsement; not medical advice.
        </footer>
      </div>
    </AppLayout>
  )
}
```

- [ ] **Step 2: Build inertia to verify it compiles**

Run: `cd admin && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add admin/inertia/pages/conditions/show.tsx
git commit -m "feat(conditions): detail page (OTC drugs + safety banner)"
```

---

## Task 12: Home tile + Drug Reference cross-link

**Files:**
- Modify: `admin/inertia/pages/home.tsx`
- Modify: `admin/inertia/pages/drug-reference/index.tsx`

- [ ] **Step 1: Add the home tile**

In `admin/inertia/pages/home.tsx`, after the `DRUG_REFERENCE_ITEM` block (currently ends `:80`), add a new item. Use an existing imported Tabler icon already in scope (e.g. `IconFirstAidKit` if imported; otherwise reuse `IconPill` or add the import alongside the other `@tabler/icons-react` imports at top of file). Confirm the icon import before using it.

```tsx
// "When to use what" — condition-first drug browsing (Phase 1). displayOrder
// 6.5: sits between Drug Reference (6) and Preparedness (7) in the numeric sort.
const CONDITIONS_ITEM = {
  label: 'When to use what',
  to: '/conditions',
  target: '',
  description: 'Pick a situation — burn, fever, diarrhea — and see what may help',
  icon: <IconFirstAidKit size={48} />,
  installed: true,
  displayOrder: 6.5,
  poweredBy: null,
}
```

Then find where the existing items are pushed into the `items` array (search for `DRUG_REFERENCE_ITEM` / `READINESS_ITEM` usage in the `items.push(...)` region) and push `CONDITIONS_ITEM` alongside them.

- [ ] **Step 2: Verify the icon import exists**

Run: `cd admin && grep -n "IconFirstAidKit\|from '@tabler/icons-react'" inertia/pages/home.tsx`
Expected: `IconFirstAidKit` appears in the import list. If absent, add it to the existing `@tabler/icons-react` import.

- [ ] **Step 3: Add the cross-link in Drug Reference index**

In `admin/inertia/pages/drug-reference/index.tsx`, in the header action area (next to the existing "Compare interactions" Link, `:171-177`), add a Link to `/conditions`:

```tsx
<Link href="/conditions">
  <StyledButton variant="outline" size="sm" onClick={() => {}}>
    Browse by situation
  </StyledButton>
</Link>
```

- [ ] **Step 4: Build inertia**

Run: `cd admin && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add admin/inertia/pages/home.tsx admin/inertia/pages/drug-reference/index.tsx
git commit -m "feat(conditions): home tile + Drug Reference cross-link"
```

---

## Task 13: Final gate — full typecheck, tests, build, manual verify

**Files:** none (verification only)

- [ ] **Step 1: Backend typecheck (gate)**

Run: `cd admin && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `cd admin && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Unit tests (gate)**

Run: `cd admin && node ace test`
Expected: all suites pass, including `conditions.spec.ts`. 0 failed.

- [ ] **Step 4: Inertia build (gate)**

Run: `cd admin && npm run build`
Expected: build succeeds (inertia baseline holds).

- [ ] **Step 5: Confirm no migration / no new deps (gate)**

Run: `git status --short database/ && git diff --stat admin/package.json admin/package-lock.json`
Expected: no new files under `admin/database/migrations/`; no change to dependency manifests.

- [ ] **Step 6: Operator mini-verify (spec requirement)**

With the app running and drug data ingested:
1. Open `/conditions` → curated grid renders grouped by category; safety banner is at the top.
2. Click "Burns" → `/conditions/burns` lists OTC-first drug rows; each links to `/drug-reference/:id`.
3. On `/conditions`, type "diarrhea" → inline OTC results appear.
4. Type an off-list free-text condition (e.g. "poison ivy") → results appear (free-text path).
5. Confirm the home tile "When to use what" links to `/conditions`, and Drug Reference's "Browse by situation" link works.

Expected: all five pass; safety banner present on both index and detail.

- [ ] **Step 7: Final commit (if any verify fixups)**

```bash
git add -A
git commit -m "chore(conditions): Phase 1 verification fixups"
```

---

## Self-Review (run against the spec)

**Spec coverage:**
- Curated spine (~30–50, slug/label/category/searchTerms) → Task 2 (36 entries) + Task 1 (types). ✅
- `ConditionService.drugsFor` FULLTEXT over `indications` reusing #11 approach → Task 4 (`searchIndications` mirrors `searchIndicationFulltext` incl. `MAX(MATCH …)`). ✅
- `/conditions` index (grid + free-text) → Tasks 6, 9, 10. ✅
- `/conditions/:slug` detail listing OTC drugs linking to Drug Reference detail → Tasks 6, 11 (`DrugResultRow` links to `/drug-reference/:id`). ✅
- Strong safety banner, prominent, gates ship → Task 8 (top-of-page on both views). ✅
- OTC-first ordering, collapsed by brand+generic → Task 3 `orderOtcFirst` + Task 4 GROUP BY. ✅
- No Phase 2: no `natural_remedies`, no NCCIH ingest, no migration → none added; Task 13 Step 5 asserts it. ✅
- Gates: tsc 0 / inertia baseline / no new deps / no migration → Task 13. ✅
- Tests: pure helpers + service-shape, no network → Task 3 unit tests. ✅
- Home/Preparedness entry point tile → Task 12. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type consistency:** `Condition`, `ConditionSummary`, `ConditionsFile`, `ConditionDrugsResult` defined in Task 1; `buildIndicationQuery`/`orderOtcFirst`/`parseConditionsFile`/`findConditionBySlug` defined in Task 3 and consumed with identical signatures in Task 4. `DrugSearchResult` reused unchanged. ✅

---

## Open verification items for the implementer (confirm at execution time)

1. **`process.cwd()` of the running admin app.** `ConditionService.spineFile` assumes cwd is `admin/` (so `..` reaches the repo-root `collections/`). Confirm via how `collection_manifest_service.ts` / `system_service.ts` resolve `process.cwd()` paths in the built app. If the running cwd differs (e.g. built into `admin/build/`), adjust the relative segments OR import the JSON directly (`import conditionsFile from '#data/...'` is not available — there's no `#data` alias; either copy the file under `admin/` and import, or keep the `readFile` path correct). **Decide before Task 4 ships.** A safe alternative: place the spine at `admin/collections/conditions.json` and resolve `path.join(process.cwd(), 'collections', 'conditions.json')` — but the spec explicitly cites the root `collections/` convention, so prefer the root location and verify the path.
2. **Inertia build script name.** Tasks say `npm run build`; confirm the exact inertia/vite build script in `admin/package.json` `scripts` (could be `build`, `build:inertia`, or part of `node ace build`). Use whatever the repo's documented inertia baseline gate uses.
3. **Home tile icon.** `IconFirstAidKit` must exist in `@tabler/icons-react` and be imported; if not, fall back to `IconPill`/`IconHeartbeat` already in scope. Verify in Task 12 Step 2.
```

---

## Review / Results (implementation, 2026-06-07)

**Shipped (all tasks):** types (`admin/types/conditions.ts`), curated 36-entry spine as a
bundled TS constant (`admin/app/data/conditions.ts`) + repo-root JSON mirror
(`collections/conditions.json`), pure helpers (`admin/util/conditions.ts`) with a standalone
test (`admin/tests/standalone/conditions.standalone.ts`, 21 checks green), service
(`admin/app/services/condition_service.ts`), validator (`admin/app/validators/conditions.ts`),
controller (`admin/app/controllers/conditions_controller.ts`), 3 routes
(`/conditions`, `/conditions/:slug`, `/api/conditions/drugs`), SafetyBanner + ConditionCard
components, `/conditions` index + `/conditions/:slug` show pages, home tile (displayOrder 6.5,
`IconFirstAidKit`), and a "Browse by situation" cross-link on Drug Reference.

**Open-item resolutions:**
1. **process.cwd() / data location — RESOLVED by NOT reading a file at runtime.** The Dockerfile
   does `ADD admin/ ./` and ships only the compiled `build/` output, so neither the repo-root
   `collections/conditions.json` nor any `admin/collections/` JSON reaches the container. The spine
   is therefore a compiled TS constant (`admin/app/data/conditions.ts`, imported relatively — there
   is no `#data` alias and one was not added) that bundles into `build/app/data/conditions.js`
   (verified present post-build). The repo-root JSON is a generated mirror for discoverability only.
   Zero path-resolution risk.
2. **Build script — `npm run build` (= `node ace build`)** bundles both the Vite/Inertia client and
   the tsc backend. Confirmed and used as the inertia gate.
3. **Home icon — `IconFirstAidKit` exists** in `@tabler/icons-react`; imported and used. No fallback
   needed.

**Final gate results:** backend `tsc --noEmit` = 0 errors; inertia `tsc -p inertia/tsconfig.json
--noEmit` = 10 errors (unchanged baseline, no new ones); standalone helper test = 21/21 green;
`npm run build` = success; no new migration; package.json / package-lock / root package.json
unchanged (no new deps, no version bump). Phase 2 (`natural_remedies`, NCCIH ingest, migration) not
built — zero references in the tree.

**Deferred (Phase 2, per spec):** `natural_remedies` table + migration, NCCIH "Herbs at a Glance"
ingest job, `remediesFor`, two-column condition view, remedy detail page, ZIM cross-reference.
