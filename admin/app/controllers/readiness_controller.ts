import type { HttpContext } from '@adonisjs/core/http'
import { ReadinessService } from '#services/readiness_service'

/**
 * Self-Reliance Suite — Phase 2 Readiness Calculator HTTP boundary.
 *
 * A single read-only page. The household config is PERSISTED through the
 * existing PATCH /api/system/settings KV endpoint (the same path the Inventory
 * units toggle uses), so this controller has no mutation action — it only
 * renders the dashboard. Ungated, matching the Inventory/Workshop page GETs.
 */
export default class ReadinessController {
  /**
   * GET /readiness — the readiness dashboard. Reads Inventory + the KV config
   * via ReadinessService (which falls back to cited defaults for any unset key,
   * so the page always renders) and hands the assembled DTO to Inertia.
   */
  async index({ inertia }: HttpContext) {
    const service = new ReadinessService()
    const dashboard = await service.compute()
    return inertia.render('readiness/index', { dashboard })
  }
}
