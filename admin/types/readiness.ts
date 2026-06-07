import type { ReadinessResource, ResourceReadiness } from '../util/readiness.js'

/**
 * Self-Reliance Suite — Phase 2 Readiness Calculator shared types.
 *
 * The Inertia page and the controller both consume these, so they live in
 * types/ (the inventory.ts convention) rather than being duplicated. The math
 * lives in util/readiness.ts (pure, unit-tested); these are the wire DTOs.
 */

/** The household config the dashboard reads + the config form edits. */
export interface ReadinessConfig {
  adults: number
  children: number
  targetHorizonDays: number
  /** Per-person-per-day needs in BASE units (water L, food kcal, power Wh). */
  needs: { water: number; food: number; power: number }
  /** Total daily pet water intake for all pets combined, base units (L/day). */
  petWaterPerDay: number
  /** Total daily pet food intake for all pets combined, base units (kcal/day). */
  petFoodPerDay: number
  /** Total daily power need, base units (Wh/day), user-entered. */
  powerPerDay: number
}

/**
 * One contributing inventory row at risk of expiring before the horizon, with
 * its base-unit contribution surfaced so the dashboard can total "X L of water
 * expires before day N." (Spec §5.2: flag separately, do NOT deduct from have.)
 */
export interface ReadinessExpiryWarning {
  id: number
  name: string
  resource: ReadinessResource
  /** Base-unit amount at risk (the row's resource_contribution). */
  amountBase: number
  /** ISO date (YYYY-MM-DD) the item expires, or null. */
  expiryDate: string | null
}

/**
 * The Inertia dashboard DTO: three per-resource readiness blocks, the config the
 * form edits, the at-risk-stock list, the horizon, and the display system so the
 * page converts water for display via util/units.ts.
 */
export interface ReadinessDashboard {
  resources: ResourceReadiness[]
  config: ReadinessConfig
  expiryWarnings: ReadinessExpiryWarning[]
  targetHorizonDays: number
  measurementSystem: 'us' | 'metric'
}
