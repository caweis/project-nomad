import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { DrugReferenceService } from '#services/drug_reference_service'
import { searchDrugValidator, interactionsValidator } from '#validators/drug_reference'
import { parseCompareIds } from '../../util/compare_ids.js'

/**
 * Drug Reference v1 — HTTP boundary.
 *
 * Two Inertia pages (index / show) + a small JSON API (search / status /
 * download). Mirrors the WorkshopController / InventoryController chain:
 *   - index/show render Inertia
 *   - JSON actions return plain objects
 *   - Integer-id guard on show
 *   - Never leak exceptions to the UI
 */
export default class DrugReferenceController {
  private get service() {
    return new DrugReferenceService()
  }

  /**
   * GET /drug-reference — search page.
   * Passes the current row count and ingest status so the empty-state
   * "download first" prompt can render server-side.
   */
  async index({ inertia }: HttpContext) {
    try {
      const [status, count] = await Promise.all([
        this.service.getIngestStatus(),
        this.service.rowCount(),
      ])

      return inertia.render('drug-reference/index', {
        ingestStatus: status,
        rowCount: count,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[DrugReferenceController] index failed: ${msg}`)
      return inertia.render('drug-reference/index', {
        ingestStatus: null,
        rowCount: 0,
      })
    }
  }

  /**
   * GET /drug-reference/:id — detail page.
   */
  async show({ inertia, params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.notFound({ error: 'invalid id' })
    }

    try {
      const label = await this.service.find(id)
      if (!label) {
        return response.notFound({ error: 'Drug label not found' })
      }

      return inertia.render('drug-reference/show', { label })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[DrugReferenceController] show(${id}) failed: ${msg}`)
      return response.internalServerError({ error: 'Could not load drug label' })
    }
  }

  /**
   * GET /api/drug-reference/search
   * Returns a slim collapsed result list (brand+generic pairs).
   */
  async search({ request, response }: HttpContext) {
    try {
      const params = await request.validateUsing(searchDrugValidator)
      const results = await this.service.search(params.q, {
        productType: params.product_type,
        limit: params.limit,
        offset: params.offset,
        scope: params.scope,
      })
      return { results }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`[DrugReferenceController] search failed: ${msg}`)
      return response.badRequest({ error: msg })
    }
  }

  /**
   * GET /api/drug-reference/status
   * Returns the live ingest status DTO.
   */
  async status({ response }: HttpContext) {
    try {
      const status = await this.service.getIngestStatus()
      return status
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[DrugReferenceController] status failed: ${msg}`)
      return response.internalServerError({ error: 'Could not read ingest status' })
    }
  }

  /**
   * GET /drug-reference/interactions — side-by-side label comparison page.
   * Passes rowCount + ingestStatus so the empty-state prompt can render,
   * mirroring the index() pattern. The actual entry data is loaded client-side
   * via /api/drug-reference/interactions?ids=… so the page is shareable via URL.
   */
  async interactions({ inertia }: HttpContext) {
    try {
      const [status, count] = await Promise.all([
        this.service.getIngestStatus(),
        this.service.rowCount(),
      ])

      return inertia.render('drug-reference/interactions', {
        ingestStatus: status,
        rowCount: count,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[DrugReferenceController] interactions page failed: ${msg}`)
      return inertia.render('drug-reference/interactions', {
        ingestStatus: null,
        rowCount: 0,
      })
    }
  }

  /**
   * GET /api/drug-reference/interactions?ids=1,2,3
   * Validates → parses → fetches and returns { entries: DrugInteractionEntry[] }.
   * Never leaks exceptions; integer-guards ids via parseCompareIds.
   */
  async interactionsApi({ request, response }: HttpContext) {
    try {
      const params = await request.validateUsing(interactionsValidator)
      const ids = parseCompareIds(params.ids ?? '')
      const entries = await this.service.getInteractionsFor(ids)
      return { entries }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`[DrugReferenceController] interactionsApi failed: ${msg}`)
      return response.badRequest({ error: msg })
    }
  }

  /**
   * POST /api/drug-reference/download
   * Triggers the ingest job (idempotent — deduped on deterministic jobId).
   */
  async download({ response }: HttpContext) {
    try {
      const result = await this.service.triggerIngest()
      return { success: true, created: result.created, message: result.message }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[DrugReferenceController] download trigger failed: ${msg}`)
      return response.internalServerError({ error: 'Could not trigger ingest' })
    }
  }
}
