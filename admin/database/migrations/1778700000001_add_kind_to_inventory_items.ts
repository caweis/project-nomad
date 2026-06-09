import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    // varchar (not native enum) — kind enforced at the Vine validator layer so it
    // grows freely, matching the rest of the Preparedness suite.
    this.schema.alterTable(this.tableName, (table) => {
      table.string('kind', 16).notNullable().defaultTo('consumable')
    })
    // Backfill: an item with a gear condition and no consumable signals is gear.
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .whereNotNull('condition')
        .whereNull('expiry_date')
        .whereNull('restock_threshold')
        .whereNull('resource_type')
        .update({ kind: 'gear' })
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.index('kind', 'idx_inventory_kind')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex('kind', 'idx_inventory_kind')
      table.dropColumn('kind')
    })
  }
}
