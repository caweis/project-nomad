import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'scenario_plan_steps'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Snapshot of the linked target's display name at link time, so a step whose
      // FK was SET NULL'd on target deletion shows "was: <name>" instead of blanking.
      table.string('linked_name_snapshot', 255).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('linked_name_snapshot')
    })
  }
}
