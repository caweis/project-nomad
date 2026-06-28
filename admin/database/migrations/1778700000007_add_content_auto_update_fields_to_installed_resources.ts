import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'installed_resources'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // A newer version detected by the content auto-update check, awaiting the
      // cool-off window before it is eligible to apply.
      table.string('available_update_version').nullable()
      table.bigInteger('available_update_size_bytes').nullable()
      // Cool-off anchor: when this newer version was first seen.
      table.timestamp('available_update_first_seen_at').nullable()
      // Per-resource failure backoff (self-disables at the threshold).
      table.integer('auto_update_consecutive_failures').notNullable().defaultTo(0)
      table.string('auto_update_disabled_reason', 255).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('available_update_version')
      table.dropColumn('available_update_size_bytes')
      table.dropColumn('available_update_first_seen_at')
      table.dropColumn('auto_update_consecutive_failures')
      table.dropColumn('auto_update_disabled_reason')
    })
  }
}
