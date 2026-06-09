import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'scenario_plan_steps'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('created_at', 'added_at')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('added_at', 'created_at')
    })
  }
}
