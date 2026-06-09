import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { CONDITIONS_FILE } from '../data/conditions.js'
import {
  parseConditionsFile,
  findConditionBySlug,
  toConditionSummary,
  buildIndicationQuery,
  orderOtcFirst,
} from '../../util/conditions.js'
import { PRODUCT_TYPES } from '../../types/drug_reference.js'
import type { Condition, ConditionSummary, ConditionDrugsResult } from '../../types/conditions.js'
import type { DrugSearchResult } from '../../types/drug_reference.js'

/**
 * "When to use what" — condition-first service (Phase 1).
 *
 * Resolves a curated condition (or a free-text situation) to the OTC drugs whose
 * FDA label indications match it. Reuses the Drug Reference indication-search
 * machinery: the same combined-FULLTEXT index (ft_drug_labels_name_indications),
 * the same MAX(MATCH …) aggregate pattern required under MySQL 8 ONLY_FULL_GROUP_BY,
 * and the same brand+generic collapse — then re-buckets results OTC-first.
 *
 * No new table, no migration. Phase 2 adds the natural-remedies half against a
 * separate table using the same condition spine.
 */
export class ConditionService {
  /** Parsed (fail-soft) curated spine — bad entries are dropped, not fatal. */
  private get spine(): Condition[] {
    return parseConditionsFile(CONDITIONS_FILE).conditions
  }

  /** All curated conditions as client-facing summaries (no searchTerms). */
  listConditions(): ConditionSummary[] {
    return this.spine.map(toConditionSummary)
  }

  /**
   * The full curated spine (WITH searchTerms) for server-side matching such as
   * the drug-detail reverse link (situationsForIndications). Stays server-only —
   * searchTerms are a search-implementation detail the client never receives.
   */
  allConditions(): Condition[] {
    return this.spine
  }

  /** Find a curated condition by slug. Returns null when absent. */
  findCondition(slug: string): Condition | null {
    return findConditionBySlug(this.spine, slug)
  }

  /**
   * Resolve a curated condition (by slug) to its matching OTC drugs.
   * Returns null when the slug is not in the curated spine so the controller can
   * 404. Drugs are OTC-only and OTC-first-ordered.
   */
  async drugsForSlug(slug: string, limit = 50): Promise<ConditionDrugsResult | null> {
    const condition = this.findCondition(slug)
    if (!condition) return null

    const drugs = await this.searchIndications(condition.searchTerms, limit)
    return { condition: toConditionSummary(condition), drugs }
  }

  /**
   * Resolve a free-text situation (off-list condition) to matching OTC drugs.
   * Treats the raw query as a single search term. Returns a synthetic condition
   * summary echoing the query so the UI can render a consistent header.
   */
  async drugsForFreeText(query: string, limit = 50): Promise<ConditionDrugsResult> {
    const trimmed = query.trim()
    const drugs = trimmed.length > 0 ? await this.searchIndications([trimmed], limit) : []
    return {
      condition: { slug: '', label: trimmed, category: 'Search' },
      drugs,
    }
  }

  /**
   * Core search: FULLTEXT over (searchable_name, indications) for the OR-expanded
   * searchTerms, OTC-filtered, collapsed by brand+generic, OTC-first-ordered.
   *
   * Strategy mirrors DrugReferenceService:
   *   1. FULLTEXT NATURAL LANGUAGE MODE on the built query (requires the query
   *      to have a >= 3-char token; innodb_ft_min_token_size = 3).
   *   2. LIKE fallback when the built query is empty/too short OR FULLTEXT throws
   *      (e.g. the index is absent) — runs each term as a LIKE clause.
   * Both paths force product_type = OTC and then orderOtcFirst (a no-op on the
   * already-OTC set, but kept so a future relaxation of the OTC filter stays
   * correctly ordered).
   */
  async searchIndications(searchTerms: string[], limit = 50): Promise<DrugSearchResult[]> {
    const ftQuery = buildIndicationQuery(searchTerms)
    // A FULLTEXT query needs a token >= innodb_ft_min_token_size (3). If the
    // longest bare token is shorter, NATURAL LANGUAGE MODE returns nothing, so
    // go straight to LIKE.
    const longestToken = ftQuery
      .replace(/"/g, ' ')
      .split(/\s+/)
      .reduce((max, t) => Math.max(max, t.length), 0)
    const useFulltext = ftQuery.length > 0 && longestToken >= 3

    if (useFulltext) {
      try {
        const rows = await this.searchIndicationFulltext(ftQuery, limit)
        return orderOtcFirst(rows)
      } catch (err) {
        logger.warn(
          `[ConditionService] FULLTEXT indication search failed, falling back to LIKE: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }

    const rows = await this.searchIndicationLike(searchTerms, limit)
    return orderOtcFirst(rows)
  }

  /**
   * FULLTEXT OTC indication search.
   *
   * MATCHes over (searchable_name, indications) — must exactly match the
   * ft_drug_labels_name_indications index column list. The MAX(MATCH …) wrapper
   * is LOAD-BEARING: MySQL 8 ONLY_FULL_GROUP_BY rejects a bare MATCH() in SELECT
   * under GROUP BY; wrapping it in MAX() makes it an aggregate. Copied verbatim
   * from DrugReferenceService.searchIndicationFulltext, with a fixed OTC filter.
   */
  private async searchIndicationFulltext(
    ftQuery: string,
    limit: number
  ): Promise<DrugSearchResult[]> {
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
        AND product_type = ?
      GROUP BY brand_name, generic_name
      ORDER BY relevance DESC
      LIMIT ?
    `
    const rows = await db.rawQuery(sql, [ftQuery, ftQuery, PRODUCT_TYPES.OTC, limit])
    return this.mapSearchRows(rows[0])
  }

  /**
   * LIKE OTC indication fallback (FULLTEXT unavailable or query too short).
   *
   * ORs a LIKE clause per search term over `indications` so any synonym can
   * surface a match. OTC-filtered and collapsed identically to the FULLTEXT path.
   */
  private async searchIndicationLike(
    searchTerms: string[],
    limit: number
  ): Promise<DrugSearchResult[]> {
    const terms = searchTerms.map((t) => t.trim()).filter((t) => t.length > 0)
    if (terms.length === 0) return []

    const likeClauses = terms.map(() => 'indications LIKE ?').join(' OR ')
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
      WHERE (${likeClauses})
        AND product_type = ?
      GROUP BY brand_name, generic_name
      ORDER BY brand_name ASC
      LIMIT ?
    `
    const bindings: unknown[] = [...terms.map((t) => `%${t}%`), PRODUCT_TYPES.OTC, limit]
    const rows = await db.rawQuery(sql, bindings)
    return this.mapSearchRows(rows[0])
  }

  /** Map raw collapsed rows to DrugSearchResult — mirrors DrugReferenceService. */
  private mapSearchRows(rows: any[]): DrugSearchResult[] {
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

  /**
   * Current drug_labels row count — drives the index page empty-state (no data →
   * point the user to Drug Reference to download first). Mirrors
   * DrugReferenceService.rowCount; returns 0 on any error.
   */
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
