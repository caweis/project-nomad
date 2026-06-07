import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type {
  InventoryCategory,
  InventoryCondition,
  ResourceType,
} from '../../types/inventory.js'

/**
 * Self-Reliance Suite — Inventory catalog entry.
 *
 * One row per tracked supply/gear item. Created and edited entirely by hand
 * through the Inventory UI — there is NO filesystem scanner (the catalog is the
 * source of truth, not a disk index, unlike Workshop's StlFile).
 *
 * Enum-typed columns (category, condition, resource_type) are plain varchars in
 * the DB; their allowed values are enforced at the Vine validator layer, so the
 * enums can grow without an ALTER TABLE — the stl_files convention.
 *
 * The resource bridge (resource_type + resource_contribution) is how an item
 * feeds the Phase 2 readiness calculator. resource_contribution is stored in
 * the BASE unit for its resource_type (water=L, food=kcal, power=Wh); display-
 * unit conversion happens at the UI boundary via util/units.ts.
 */
export default class InventoryItem extends BaseModel {
  static table = 'inventory_items'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare category: InventoryCategory

  /**
   * MySQL returns DECIMAL columns as strings via the driver. A defensive
   * consume coerces to a JS number so callers (the calculator's sumByResource,
   * the contributesToReadiness predicate, the UI) always see a number, never a
   * stringified decimal. Tolerates null/empty without producing NaN.
   */
  @column({ consume: toNumber })
  declare quantity: number

  /** Free-text display label the user types ("gal", "cans", "rounds"). Never math-converted. */
  @column()
  declare unit: string

  @column()
  declare location: string | null

  @column()
  declare notes: string | null

  @column.date()
  declare expiry_date: DateTime | null

  @column({ consume: toNullableNumber })
  declare restock_threshold: number | null

  @column()
  declare condition: InventoryCondition | null

  @column()
  declare resource_type: ResourceType | null

  /** Amount the whole row contributes to its resource, in the BASE unit. Null when resource_type is null. */
  @column({ consume: toNullableNumber })
  declare resource_contribution: number | null

  @column.dateTime({ autoCreate: true, columnName: 'added_at' })
  declare added_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updated_at: DateTime

  /**
   * Whether this row feeds the readiness calculator. Mirrors the static-
   * predicate style of StlFile.isMetadataComplete. Used by the service when
   * summing per resource and by the UI to badge "counts toward readiness."
   */
  static contributesToReadiness(row: {
    resource_type: ResourceType | null
    resource_contribution: number | null
  }): boolean {
    return (
      row.resource_type !== null &&
      row.resource_contribution !== null &&
      row.resource_contribution > 0
    )
  }
}

/**
 * Coerce a Lucid DECIMAL value (string from the MySQL driver) to a number,
 * defaulting to 0 for null/empty/unparseable so a NOT NULL DEFAULT 0 column
 * never surfaces as NaN.
 */
function toNumber(value: string | number | null): number {
  if (value === null || value === '') return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Same coercion but preserves null for nullable DECIMAL columns. */
function toNullableNumber(value: string | number | null): number | null {
  if (value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
