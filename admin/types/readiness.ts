import type { ReadinessResource, ResourceReadiness } from '../util/readiness.js'
import type { FoodSource } from '../util/grocy_food_energy.js'

/**
 * Self-Reliance Suite — Phase 2 Readiness Calculator shared types.
 *
 * The Inertia page and the controller both consume these, so they live in
 * types/ (the inventory.ts convention) rather than being duplicated. The math
 * lives in util/readiness.ts (pure, unit-tested); these are the wire DTOs.
 */

/** The selectable companion-animal types. 'other' carries user-entered figures. */
export type PetType = 'dog' | 'cat' | 'rabbit' | 'guineaPig' | 'ferret' | 'bird' | 'other'

/**
 * Typical-adult per-pet/day needs in BASE units (water L, food kcal), with the
 * cited basis for the two figures. Lives in app/data/pet_needs.ts.
 */
export interface PetNeed {
  /** Water per pet per day, liters. */
  waterL: number
  /** Food per pet per day, kilocalories. */
  kcal: number
  /** Cited basis for the two figures (Merck/MSD, AAHA/WSAVA, etc.). */
  source: string
}

/**
 * One household pet row: a type and a count. For 'other' (no built-in estimate)
 * the user also supplies per-pet water (L) and calories (kcal); for the typed
 * species these are omitted and PET_NEEDS supplies the per-pet figures.
 */
export interface PetEntry {
  type: PetType
  count: number
  /** Per-pet water (L/day), only meaningful for type 'other'. */
  waterL?: number
  /** Per-pet food (kcal/day), only meaningful for type 'other'. */
  kcal?: number
}

/** The household config the dashboard reads + the config form edits. */
export interface ReadinessConfig {
  adults: number
  children: number
  targetHorizonDays: number
  /** Per-person-per-day needs in BASE units (water L, food kcal, power Wh). */
  needs: { water: number; food: number; power: number }
  /**
   * The household's pets as typed entries; the calculator multiplies each by
   * PET_NEEDS (or the entry's own figures for 'other') to derive total pet
   * water/food. Persisted as the `readiness.pets` KV JSON array.
   */
  pets: PetEntry[]
  /**
   * Total daily pet water intake for all pets combined, base units (L/day).
   * Legacy fallback for installs that predate typed pets — read but no longer
   * written.
   */
  petWaterPerDay: number
  /**
   * Total daily pet food intake for all pets combined, base units (kcal/day).
   * Legacy fallback (see petWaterPerDay).
   */
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
  /** Whether the Grocy integration is enabled + configured (drives the food-card note). */
  grocyConfigured: boolean
  /** Where the food "have" came from: the Grocy container or in-app inventory. */
  foodSource: FoodSource
  /** Present when food is Grocy-sourced: in-stock products with calorie data. */
  grocyCoverage?: { covered: number; total: number }
}
