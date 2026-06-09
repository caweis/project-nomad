import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index('restock_threshold', 'idx_inventory_restock')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex('restock_threshold', 'idx_inventory_restock')
    })
  }
}
