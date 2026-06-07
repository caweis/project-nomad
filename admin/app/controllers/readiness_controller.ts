import type { HttpContext } from '@adonisjs/core/http'
import { ReadinessService } from '#services/readiness_service'
import { ScenarioPlanService } from '#services/scenario_plan_service'
import { SCENARIO_LABELS, SCENARIOS } from '../../types/scenarios.js'

/** The two tabs of the Preparedness page. */
const READINESS_TABS = ['supply', 'plans'] as const
type ReadinessTab = (typeof READINESS_TABS)[number]

/**
 * Self-Reliance Suite — Preparedness HTTP boundary.
 *
 * One page with two tabs: "Supply Readiness" (the Phase 2 days-of-supply
 * calculator + household config) and "Scenario Plans" (the Phase 3 per-scenario
 * checklist list). Both datasets are server-rendered so toggling tabs needs no
 * second fetch. The active tab is driven by the `?tab=supply|plans` query param
 * so it is linkable and survives `router.reload()`.
 *
 * The household config is PERSISTED through the existing PATCH
 * /api/system/settings KV endpoint (the same path the Inventory units toggle
 * uses), and plan/step mutations go through the /api/plans group — so this
 * controller has no mutation action, it only renders. Ungated, matching the
 * Inventory/Workshop page GETs.
 */
export default class ReadinessController {
  /**
   * GET /readiness — the Preparedness. Reads Inventory + the KV config via
   * ReadinessService (which falls back to cited defaults for any unset key, so
   * the page always renders) and the scenario-plan list via ScenarioPlanService,
   * then hands both to Inertia along with the active tab.
   */
  async index({ inertia, request }: HttpContext) {
    const dashboard = await new ReadinessService().compute()
    const plans = await new ScenarioPlanService().listPlans()

    return inertia.render('readiness/index', {
      dashboard,
      plans,
      enums: { scenarios: SCENARIOS.map((s) => ({ value: s, label: SCENARIO_LABELS[s] })) },
      tab: this.resolveTab(request.input('tab')),
    })
  }

  /** Coerce the `?tab` query value to a known tab, defaulting to "supply". */
  private resolveTab(raw: unknown): ReadinessTab {
    return READINESS_TABS.includes(raw as ReadinessTab) ? (raw as ReadinessTab) : 'supply'
  }
}
