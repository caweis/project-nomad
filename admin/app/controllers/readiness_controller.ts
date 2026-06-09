import type { HttpContext } from '@adonisjs/core/http'
import KVStore from '#models/kv_store'
import { InventoryService } from '#services/inventory_service'
import { ReadinessService } from '#services/readiness_service'
import { ScenarioPlanService } from '#services/scenario_plan_service'
import { listInventoryItemsValidator } from '#validators/inventory'
import {
  CATEGORY_LABELS,
  INVENTORY_CATEGORIES,
  INVENTORY_CONDITIONS,
  INVENTORY_KINDS,
  MEASUREMENT_SYSTEMS,
  RESOURCE_BASE_UNITS,
  RESOURCE_TYPES,
  type MeasurementSystem,
} from '../../types/inventory.js'
import { SCENARIO_LABELS, SCENARIOS } from '../../types/scenarios.js'

/** The three tabs of the Preparedness page, in the data → assessment → response order. */
const READINESS_TABS = ['inventory', 'supply', 'plans'] as const
type ReadinessTab = (typeof READINESS_TABS)[number]

/**
 * Self-Reliance Suite — Preparedness HTTP boundary.
 *
 * One page with three tabs: "Inventory" (the unified supplies/gear catalog —
 * cards, filters, pagination, units toggle), "Supply Readiness" (the Phase 2
 * days-of-supply calculator + household config), and "Scenario Plans" (the
 * Phase 3 per-scenario checklist list). The active tab is driven by the
 * `?tab=inventory|supply|plans` query param (default `inventory`) so it is
 * linkable and survives `router.reload()`.
 *
 * Per-tab loading: only the active tab's dataset is fetched. The inventory tab
 * runs the filtered/paginated inventory list (so it scales), the supply tab
 * runs the readiness dashboard, and the plans tab runs the plan list — the
 * other two are never queried. The measurement system + tab-bar enums are
 * always supplied so the header and tab strip render regardless of tab.
 *
 * The household config is PERSISTED through the existing PATCH
 * /api/system/settings KV endpoint (the same path the Inventory units toggle
 * uses), and plan/step + inventory mutations go through the /api/plans and
 * /api/inventory groups — so this controller has no mutation action, it only
 * renders. Ungated, matching the Inventory/Workshop page GETs.
 */
export default class ReadinessController {
  /**
   * GET /readiness — the Preparedness. Resolves the active tab from `?tab` and
   * loads ONLY that tab's data, then hands it to Inertia along with the
   * measurement system and tab-bar enums.
   */
  async index({ inertia, request }: HttpContext) {
    const tab = this.resolveTab(request.input('tab'))
    const measurementSystem = await this.measurementSystem()

    // Props shared by every tab so the header + tab strip always render.
    const shared = {
      tab,
      measurement_system: measurementSystem,
      enums: {
        // Scenario enums power the Scenario Plans tab; inventory enums power the
        // Inventory tab's filter sidebar + badges. Both are tiny constant lists,
        // so shipping them on every render keeps the page self-contained without
        // a measurable cost.
        scenarios: SCENARIOS.map((s) => ({ value: s, label: SCENARIO_LABELS[s] })),
        categories: INVENTORY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
        kinds: [...INVENTORY_KINDS],
        conditions: [...INVENTORY_CONDITIONS],
        resource_types: [...RESOURCE_TYPES],
        resource_base_units: RESOURCE_BASE_UNITS,
      },
    }

    if (tab === 'inventory') {
      const filters = await request.validateUsing(listInventoryItemsValidator)
      const inventoryService = new InventoryService()
      const { items, pagination } = await inventoryService.list(filters)
      const locations = await inventoryService.distinctLocations()
      return inertia.render('readiness/index', {
        ...shared,
        inventoryItems: items,
        pagination,
        inventoryFilters: filters,
        locations,
      })
    }

    if (tab === 'plans') {
      const plans = await new ScenarioPlanService().listPlans()
      return inertia.render('readiness/index', {
        ...shared,
        plans,
      })
    }

    // tab === 'supply'
    const dashboard = await new ReadinessService().compute()
    return inertia.render('readiness/index', {
      ...shared,
      dashboard,
    })
  }

  /** Coerce the `?tab` query value to a known tab, defaulting to "inventory". */
  private resolveTab(raw: unknown): ReadinessTab {
    return READINESS_TABS.includes(raw as ReadinessTab) ? (raw as ReadinessTab) : 'inventory'
  }

  /** Read the measurement-system preference, defaulting to 'us'. */
  private async measurementSystem(): Promise<MeasurementSystem> {
    const raw = await KVStore.getValue('inventory.measurementSystem')
    return (MEASUREMENT_SYSTEMS as readonly string[]).includes(raw ?? '')
      ? (raw as MeasurementSystem)
      : 'us'
  }
}
