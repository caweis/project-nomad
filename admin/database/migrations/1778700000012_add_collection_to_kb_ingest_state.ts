import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Subject/collection organization for the Knowledge Base (upstream #1063).
 * Nullable — null means "uncategorized", which is also what every existing
 * row becomes, so this is a purely additive change to the live #883 table.
 */
export default class extends BaseSchema {
  protected tableName = 'kb_ingest_state'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('collection').nullable().index()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('collection')
    })
  }
}
