import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'inventory_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('never_expires').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('never_expires')
    })
  }
}
