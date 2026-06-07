import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { QueueService } from './queue_service.js'
import { IngestDrugLabelsJob } from '#jobs/ingest_drug_labels_job'
import { normalizeDrugName } from '../../util/drug_labels.js'
import KVStore from '#models/kv_store'
import type {
  DrugSearchResult,
  DrugLabelDetail,
  DrugIngestStatus,
  DrugIngestPhase,
  DrugIngestState,
} from '../../types/drug_reference.js'

/**
 * Drug Reference v1 — service layer.
 *
 * Exposes search (collapsed by brand+generic), detail fetch, ingest trigger,
 * and ingest status. Mirrors the shape of DownloadService/ZimService.
 */
export class DrugReferenceService {
  /**
   * Search for drug labels, collapsed by (brand_name, generic_name).
   *
   * Each distinct (brand_name, generic_name) pair returns ONE result — a
   * representative row id (MIN(id)) and a labelCount of how many set_ids
   * collapsed into it. This is the locked UX decision.
   *
   * Strategy:
   *   1. FULLTEXT path: MATCH(searchable_name) AGAINST(? IN NATURAL LANGUAGE MODE)
   *      — relevance-ranked, requires >= 3 chars (innodb_ft_min_token_size = 3).
   *   2. LIKE fallback: query < 3 chars OR FULLTEXT throws → LIKE '%term%'.
   *   3. Both paths apply the optional product_type filter and GROUP BY collapse.
   */
  async search(
    query: string,
    options: { productType?: string; limit?: number; offset?: number }
  ): Promise<DrugSearchResult[]> {
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const normalized = normalizeDrugName(query, null) ?? query.trim()

    if (!normalized || normalized.length === 0) return []

    const useLike = normalized.length < 3

    if (!useLike) {
      // FULLTEXT path
      try {
        return await this.searchFulltext(normalized, options.productType, limit, offset)
      } catch (err) {
        logger.warn(
          `[DrugReferenceService] FULLTEXT search failed, falling back to LIKE: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }

    // LIKE fallback
    return await this.searchLike(normalized, options.productType, limit, offset)
  }

  private async searchFulltext(
    normalized: string,
    productType: string | undefined,
    limit: number,
    offset: number
  ): Promise<DrugSearchResult[]> {
    let sql = `
      SELECT
        MIN(id) AS id,
        brand_name,
        generic_name,
        MIN(manufacturer) AS manufacturer,
        MIN(route) AS route,
        MIN(product_type) AS product_type,
        COUNT(*) AS labelCount,
        MAX(MATCH(searchable_name) AGAINST(? IN NATURAL LANGUAGE MODE)) AS relevance
      FROM drug_labels
      WHERE MATCH(searchable_name) AGAINST(? IN NATURAL LANGUAGE MODE)
    `
    const bindings: unknown[] = [normalized, normalized]

    if (productType) {
      sql += ' AND product_type = ?'
      bindings.push(productType)
    }

    sql += `
      GROUP BY brand_name, generic_name
      ORDER BY relevance DESC
      LIMIT ? OFFSET ?
    `
    bindings.push(limit, offset)

    const rows = await db.rawQuery(sql, bindings)
    return this.mapSearchRows(rows[0])
  }

  private async searchLike(
    normalized: string,
    productType: string | undefined,
    limit: number,
    offset: number
  ): Promise<DrugSearchResult[]> {
    const term = `%${normalized}%`
    let sql = `
      SELECT
        MIN(id) AS id,
        brand_name,
        generic_name,
        MIN(manufacturer) AS manufacturer,
        MIN(route) AS route,
        MIN(product_type) AS product_type,
        COUNT(*) AS labelCount
      FROM drug_labels
      WHERE (searchable_name LIKE ? OR brand_name LIKE ?)
    `
    const bindings: unknown[] = [term, term]

    if (productType) {
      sql += ' AND product_type = ?'
      bindings.push(productType)
    }

    sql += `
      GROUP BY brand_name, generic_name
      ORDER BY brand_name ASC
      LIMIT ? OFFSET ?
    `
    bindings.push(limit, offset)

    const rows = await db.rawQuery(sql, bindings)
    return this.mapSearchRows(rows[0])
  }

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
   * Load the full detail for a single drug label row by its surrogate id.
   * Returns null if the row doesn't exist.
   */
  async find(id: number): Promise<DrugLabelDetail | null> {
    const { default: DrugLabel } = await import('#models/drug_label')
    const row = await DrugLabel.find(id)
    if (!row) return null

    return {
      id: row.id,
      set_id: row.set_id,
      spl_id: row.spl_id,
      version: row.version,
      brand_name: row.brand_name,
      generic_name: row.generic_name,
      manufacturer: row.manufacturer,
      product_ndc: row.product_ndc,
      route: row.route,
      product_type: row.product_type,
      indications: row.indications,
      dosage: row.dosage,
      warnings: row.warnings,
      boxed_warning: row.boxed_warning,
      drug_interactions: row.drug_interactions,
      contraindications: row.contraindications,
      when_using: row.when_using,
      stop_use: row.stop_use,
      source_updated_at: row.source_updated_at,
      ingested_at: row.ingested_at.toISO() ?? '',
    }
  }

  /**
   * Get current row count — what's searchable right now.
   */
  async rowCount(): Promise<number> {
    try {
      const result = await db.rawQuery('SELECT COUNT(*) AS cnt FROM drug_labels')
      const rows = result[0] as Array<{ cnt: number | string }>
      return Number(rows[0]?.cnt ?? 0)
    } catch {
      return 0
    }
  }

  /**
   * Dispatch the ingest job (idempotent — deduped by deterministic jobId).
   * Returns "already running" if the job is active/waiting.
   */
  async triggerIngest() {
    return IngestDrugLabelsJob.dispatch()
  }

  /**
   * Return the rich ingest status for the UI panel.
   * Reads the deterministic job (drug-labels-ingest) from BullMQ and merges
   * it with the KV last-updated marker and the live row count.
   */
  async getIngestStatus(): Promise<DrugIngestStatus> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(IngestDrugLabelsJob.queue)

    // Find the canonical job first (deterministic id). If it's done/absent,
    // scan active+waiting jobs for a continuation (auto-id jobs from pass > 0).
    let job = await queue.getJob(IngestDrugLabelsJob.jobId)

    // If the deterministic job is not found or completed, check for an active
    // continuation (a non-deterministic-id job in active/waiting/delayed states).
    if (!job || (await job.getState()) === 'completed') {
      const activeJobs = await queue.getJobs(['active', 'waiting', 'delayed'])
      // Pick the most-progressed continuation (highest partIndex).
      const continuation = activeJobs
        .filter((j) => j.id !== IngestDrugLabelsJob.jobId)
        .sort((a, b) => (b.data?.partIndex ?? 0) - (a.data?.partIndex ?? 0))[0]
      if (continuation) job = continuation
    }

    const lastUpdated = await KVStore.getValue('drugReference.lastUpdatedExportDate')
    const count = await this.rowCount()

    if (!job) {
      return {
        state: 'idle',
        progress: 0,
        phase: count > 0 ? 'completed' : 'manifest',
        partIndex: 0,
        totalParts: 0,
        currentPartName: null,
        recordsIngested: 0,
        recordsSkipped: 0,
        lastUpdated: lastUpdated ?? null,
        rowCount: count,
      }
    }

    const state = await job.getState()
    const data = job.data ?? {}
    const progress = typeof job.progress === 'number' ? job.progress : 0

    const ingestState: DrugIngestState =
      state === 'failed' ? 'failed'
        : state === 'completed' ? 'completed'
        : state === 'active' || state === 'waiting' || state === 'delayed' ? 'running'
        : 'idle'

    return {
      state: ingestState,
      progress,
      phase: (data.phase as DrugIngestPhase) ?? 'manifest',
      partIndex: data.partIndex ?? 0,
      totalParts: data.totalParts ?? 0,
      currentPartName: data.currentPartName ?? null,
      recordsIngested: data.recordsIngested ?? 0,
      recordsSkipped: data.recordsSkipped ?? 0,
      failedReason: job.failedReason || undefined,
      lastUpdated: lastUpdated ?? null,
      rowCount: count,
    }
  }
}
