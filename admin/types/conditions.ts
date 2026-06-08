/**
 * "When to use what" — condition-first reference types (Phase 1).
 *
 * A condition (situation) is a curated first-aid / emergency scenario the user
 * browses or searches. Each carries `searchTerms` (synonyms) that drive the
 * FULLTEXT search over `drug_labels.indications` — the same machinery the
 * Drug Reference indication search (#11) uses.
 *
 * Phase 1 maps conditions → OTC drugs only. Natural remedies (Phase 2) reuse
 * the same condition spine against a separate table and are out of scope here.
 *
 * All server → client transfer shapes for this feature live in this file.
 */

import type { DrugSearchResult } from './drug_reference.js'

// ─── Curated condition spine ──────────────────────────────────────────────────

/**
 * One curated condition/situation.
 *
 * - `slug`        URL-safe stable id (e.g. "burns"). The detail route key.
 * - `label`       Human-facing name (e.g. "Burns").
 * - `category`    Grouping for the browse grid (e.g. "Skin & wounds").
 * - `searchTerms` Synonyms expanded into the FULLTEXT query (e.g.
 *                 ["burn", "scald", "sunburn"]). Curation quality drives
 *                 result quality, so these are hand-tuned, not generated.
 */
export interface Condition {
  slug: string
  label: string
  category: string
  searchTerms: string[]
}

/**
 * The versioned condition-spine file shape. `version` lets the curated list
 * evolve without a migration (the taxonomy is data, not schema), mirroring the
 * `spec_version` field on collections/kiwix-categories.json.
 */
export interface ConditionsFile {
  version: string
  conditions: Condition[]
}

// ─── DTOs (server → client) ───────────────────────────────────────────────────

/**
 * Slim condition shape for the browse grid — omits `searchTerms` (a
 * server-only search-implementation detail the client never needs).
 */
export interface ConditionSummary {
  slug: string
  label: string
  category: string
}

/**
 * Result of resolving a condition (by slug or free text) to matching OTC drugs.
 *
 * - `condition` is the matched curated condition when resolving by slug, or a
 *   synthetic summary echoing the free-text query when off-list.
 * - `drugs` reuses the Drug Reference collapsed search result shape so the
 *   existing DrugResultRow renders them unchanged.
 */
export interface ConditionDrugsResult {
  condition: ConditionSummary
  drugs: DrugSearchResult[]
}
