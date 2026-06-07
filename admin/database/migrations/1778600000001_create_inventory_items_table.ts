import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Self-Reliance Suite — Inventory item catalog.
 *
 * Phase 1 of the Self-Reliance Suite. A unified, hand-curated catalog of
 * supplies, gear, and resource-mapped items. Unlike Workshop's stl_files, there
 * is no on-disk source of truth — these rows ARE the data.
 *
 * Enum-valued columns (category, condition, resource_type) are plain varchars,
 * not native MySQL enums: validation is enforced at the Vine layer so the enum
 * sets can grow without an ALTER TABLE (the stl_files convention).
 *
 * resource_contribution is stored in the BASE unit for its resource_type
 * (water=L, food=kcal, power=Wh); the UI converts to/from the user's display
 * unit. The composite (resource_type, resource_contribution) index supports the
 * Phase 2 calculator's per-resource SUM.
 */
export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()

      table.string('name', 255).notNullable()

      // Enum enforced at the validator layer; varchar so it grows freely.
      table.string('category', 32).notNullable().defaultTo('other')

      // Decimal so fractional stock ("2.5 gal") is expressible.
      table.decimal('quantity', 12, 3).notNullable().defaultTo(0)

      // Free-text display label ("gal", "cans", "rounds"). Display only.
      table.string('unit', 32).notNullable().defaultTo('')

      table.string('location', 255).nullable()
      table.text('notes').nullable()

      // Consumables only — drives "expiring soon" + Phase 2 expiry warnings.
      table.date('expiry_date').nullable()

      // Low-stock is computed (quantity <= restock_threshold), not a stored flag.
      table.decimal('restock_threshold', 12, 3).nullable()

      // Gear condition enum (validator-enforced).
      table.string('condition', 16).nullable()

      // Bridge to the Phase 2 calculator. null = excluded from readiness math.
      table.string('resource_type', 16).nullable()

      // Contribution in the BASE unit for resource_type. null when unmapped.
      table.decimal('resource_contribution', 14, 3).nullable()

      table.timestamp('added_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes matching the list filters and the calculator/low-stock reads.
      table.index('category', 'idx_inventory_category')
      table.index('expiry_date', 'idx_inventory_expiry')
      table.index('resource_type', 'idx_inventory_resource_type')
      table.index('location', 'idx_inventory_location')
      // Serves the Phase 2 per-resource SUM (sumByResource).
      table.index(
        ['resource_type', 'resource_contribution'],
        'idx_inventory_resource_type_contribution'
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
