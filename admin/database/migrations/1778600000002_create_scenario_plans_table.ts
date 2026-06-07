import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Self-Reliance Suite — Scenario Plans (Phase 3).
 *
 * Editable, checkable per-scenario plans. The `scenario` column is a plain
 * varchar, not a native MySQL enum: its allowed values are enforced at the Vine
 * layer so the set can grow without an ALTER TABLE (the stl_files / inventory
 * convention). Steps live in a separate scenario_plan_steps table (see the next
 * migration) so each step's typed cross-link FKs and its mutable `checked`
 * boolean are first-class rows, not entries in a rewritten JSON blob.
 *
 * Timestamps follow the inventory_items convention: added_at (autoCreate) +
 * updated_at (autoCreate + autoUpdate).
 */
export default class extends BaseSchema {
  protected tableName = 'scenario_plans'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()

      // Enum enforced at the validator layer; varchar so it grows freely.
      table.string('scenario', 32).notNullable()

      table.string('title', 255).notNullable()
      table.text('description').nullable()

      table.timestamp('added_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Serves the list page's group/filter by scenario.
      table.index('scenario', 'idx_scenario_plans_scenario')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
