import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The documents an assistant answer was given to read, stored with the answer
 * so a reopened conversation still shows them (upstream #1179). A JSON array,
 * nullable: null is every message written before this, and every answer that
 * drew on nothing. Upstream's filename, kept so the two stay one migration.
 */
export default class extends BaseSchema {
  protected tableName = 'chat_messages'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('sources').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('sources')
    })
  }
}
