import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'benchmark_results'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.double('score_v2_ai_tokens_per_second').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('score_v2_ai_tokens_per_second')
    })
  }
}
