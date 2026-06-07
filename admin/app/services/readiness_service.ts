import { DateTime } from 'luxon'
import KVStore from '#models/kv_store'
import { InventoryService } from '#services/inventory_service'
import {
  computeResourceReadiness,
  type ReadinessResource,
  type ResourceReadiness,
} from '../../util/readiness.js'
import { MEASUREMENT_SYSTEMS, type MeasurementSystem } from '../../types/inventory.js'
import type {
  ReadinessConfig,
  ReadinessDashboard,
  ReadinessExpiryWarning,
} from '../../types/readiness.js'

/**
 * Self-Reliance Suite — Phase 2 Readiness Calculator service (thin).
 *
 * Stores NO new stock (canonical data, Maxim 4): it READS Inventory via
 * InventoryService (sumByResource + expiringBefore) and reads the household
 * config from the existing KV store, then runs the pure helper
 * (util/readiness.ts) to assemble the dashboard DTO. The only persisted state is
 * the KV config, written through the existing PATCH /api/system/settings
 * endpoint — this service never writes.
 *
 * Every KV read is defensive (the kv_store consume pattern): a missing or
 * malformed value falls back to the documented, cited §5.1.1 default so the page
 * always renders.
 */

/** Cited §5.1.1 defaults — base units (water L, food kcal, power Wh). */
const DEFAULT_NEEDS = { water: 3.785411784, food: 2000, power: 0 } as const
const DEFAULT_ADULTS = 2
const DEFAULT_CHILDREN = 0
const DEFAULT_HORIZON_DAYS = 14
const DEFAULT_PET_WATER = 0
const DEFAULT_PET_FOOD = 0
const DEFAULT_POWER = 0

/** Upper bound on the horizon to keep `gap`/`days` sane (spec §5.4 validator: ≤ 365). */
const MAX_HORIZON_DAYS = 365

export class ReadinessService {
  /**
   * Build the readiness dashboard: per-resource readiness, the editable config,
   * the at-risk-stock list, and the display system.
   */
  async compute(): Promise<ReadinessDashboard> {
    const config = await this.readConfig()
    const inventory = new InventoryService()

    // "Have" per resource (base units), in parallel.
    const [waterSum, foodSum, powerSum] = await Promise.all([
      inventory.sumByResource('water'),
      inventory.sumByResource('food'),
      inventory.sumByResource('power'),
    ])

    // people = adults + children (BOTH full persons; NO discount per §5.1.1).
    const people = config.adults + config.children

    const resources: ResourceReadiness[] = [
      computeResourceReadiness(
        'water',
        waterSum.total_base,
        people,
        config.needs.water,
        config.petWaterPerDay,
        config.targetHorizonDays
      ),
      computeResourceReadiness(
        'food',
        foodSum.total_base,
        people,
        config.needs.food,
        config.petFoodPerDay,
        config.targetHorizonDays
      ),
      // Power: per-person need is the cited 0 default; the user-entered daily
      // total is supplied as the "pet" intake slot would be (a flat add), but
      // power has no per-person standard, so the whole load lives in powerPerDay.
      // computeResourceReadiness zeros the pet term for 'power', so we pass the
      // load as perPersonNeed with people=1 to keep the flat-total semantics.
      computeResourceReadiness('power', powerSum.total_base, 1, config.powerPerDay, 0, config.targetHorizonDays),
    ]

    const expiryWarnings = await this.expiryWarnings(inventory, config.targetHorizonDays)

    return {
      resources,
      config,
      expiryWarnings,
      targetHorizonDays: config.targetHorizonDays,
      measurementSystem: await this.measurementSystem(),
    }
  }

  /**
   * Contributing inventory rows whose expiry falls before `today + horizon`,
   * mapped to the dashboard warning DTO. InventoryService.expiringBefore already
   * filters to rows that contribute to a resource (resource_type set,
   * contribution > 0), so a non-resource item never appears here. The amount is
   * flagged separately — `have` is NOT reduced (spec §5.2, §9 Q5).
   */
  private async expiryWarnings(
    inventory: InventoryService,
    horizonDays: number
  ): Promise<ReadinessExpiryWarning[]> {
    const horizon = DateTime.now().startOf('day').plus({ days: horizonDays })
    const rows = await inventory.expiringBefore(horizon)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      resource: row.resource_type as ReadinessResource,
      amountBase: row.resource_contribution ?? 0,
      expiryDate: row.expiry_date ? row.expiry_date.toISODate() : null,
    }))
  }

  /**
   * Read the household config from KV with defensive fallback to the cited
   * §5.1.1 defaults for any missing or malformed key.
   */
  private async readConfig(): Promise<ReadinessConfig> {
    const [
      adultsRaw,
      childrenRaw,
      needsRaw,
      horizonRaw,
      petWaterRaw,
      petFoodRaw,
      powerRaw,
    ] = await Promise.all([
      KVStore.getValue('readiness.householdAdults'),
      KVStore.getValue('readiness.householdChildren'),
      KVStore.getValue('readiness.needs'),
      KVStore.getValue('readiness.targetHorizonDays'),
      KVStore.getValue('readiness.petWaterPerDay'),
      KVStore.getValue('readiness.petFoodPerDay'),
      KVStore.getValue('readiness.powerPerDay'),
    ])

    return {
      adults: parseInteger(adultsRaw, DEFAULT_ADULTS),
      children: parseInteger(childrenRaw, DEFAULT_CHILDREN),
      targetHorizonDays: clampHorizon(parseInteger(horizonRaw, DEFAULT_HORIZON_DAYS)),
      needs: parseNeeds(needsRaw),
      petWaterPerDay: parseNonNegativeFloat(petWaterRaw, DEFAULT_PET_WATER),
      petFoodPerDay: parseNonNegativeFloat(petFoodRaw, DEFAULT_PET_FOOD),
      powerPerDay: parseNonNegativeFloat(powerRaw, DEFAULT_POWER),
    }
  }

  /** Read the measurement-system preference, defaulting to 'us' (matches InventoryController). */
  private async measurementSystem(): Promise<MeasurementSystem> {
    const raw = await KVStore.getValue('inventory.measurementSystem')
    return (MEASUREMENT_SYSTEMS as readonly string[]).includes(raw ?? '')
      ? (raw as MeasurementSystem)
      : 'us'
  }
}

/** Parse a non-negative integer string; fall back to `fallback` on any failure. */
function parseInteger(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Parse a non-negative float string; fall back to `fallback` on any failure. */
function parseNonNegativeFloat(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Clamp the horizon into [1, MAX_HORIZON_DAYS] so display/gap math stays sane. */
function clampHorizon(days: number): number {
  if (!Number.isFinite(days) || days < 1) return DEFAULT_HORIZON_DAYS
  return Math.min(days, MAX_HORIZON_DAYS)
}

/**
 * Defensively JSON-parse the `readiness.needs` blob. Any missing/invalid field
 * falls back to its cited default, so a corrupt KV value can never crash the
 * dashboard or feed NaN into the calculator (kv_store consume pattern).
 */
function parseNeeds(raw: string | null): { water: number; food: number; power: number } {
  if (raw === null) return { ...DEFAULT_NEEDS }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<'water' | 'food' | 'power', unknown>>
    return {
      water: nonNegativeOr(parsed.water, DEFAULT_NEEDS.water),
      food: nonNegativeOr(parsed.food, DEFAULT_NEEDS.food),
      power: nonNegativeOr(parsed.power, DEFAULT_NEEDS.power),
    }
  } catch {
    return { ...DEFAULT_NEEDS }
  }
}

/** A finite, non-negative number, else the fallback. */
function nonNegativeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}
