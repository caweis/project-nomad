import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Map marker management (upstream a01aa5dc): per-marker custom color, icon, icon
 * color and visibility.
 *
 * Upstream put these columns into its original create-table migration and also
 * shipped this migration for existing installs, guarded to skip when the columns
 * are already there. This fork's markers table comes from its own 1778700000008,
 * which is left as it is, so this is the one place the columns are added and
 * needs no guard.
 */
export default class extends BaseSchema {
  protected tableName = 'map_markers'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('custom_color', 7).nullable() // "#aabbcc"
      table.string('icon', 50).nullable() // "tabler:IconDroplet"
      table.string('icon_color', 7).nullable()
      table.boolean('visible').notNullable().defaultTo(true)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('custom_color')
      table.dropColumn('icon')
      table.dropColumn('icon_color')
      table.dropColumn('visible')
    })
  }
}
