import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Self-Reliance Suite — Scenario Plan steps (Phase 3).
 *
 * One row per ordered, checkable step within a plan. Each step carries AT MOST
 * ONE optional typed cross-link — to an inventory item, an STL file, or a ZIM
 * article — identified by which of the three nullable fields is set (no separate
 * link_type column; the fields are mutually exclusive by construction and the
 * pure helper resolveStepLink applies a deterministic precedence).
 *
 * FK delete behavior:
 *   • plan_id → scenario_plans.id, onDelete CASCADE — deleting a plan removes
 *     its steps.
 *   • inventory_item_id → inventory_items.id, onDelete SET NULL — deleting a
 *     linked inventory item degrades the step's link to "unlinked" rather than
 *     orphaning or breaking the plan (data-cascade safety).
 *   • stl_file_id → stl_files.id, onDelete SET NULL — same degradation for a
 *     deleted STL file.
 *
 * Storing a single-row `checked` boolean (vs a JSON-blob rewrite) keeps a
 * checkbox toggle a single-row PATCH, avoiding lost-update races on rapid
 * toggling.
 */
export default class extends BaseSchema {
  protected tableName = 'scenario_plan_steps'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()

      table
        .bigInteger('plan_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('scenario_plans')
        .onDelete('CASCADE')

      table.integer('position').notNullable().defaultTo(0)
      table.string('text', 1000).notNullable()
      table.boolean('checked').notNullable().defaultTo(false)

      // At most one of the three cross-link fields is set (validator-enforced).
      table
        .bigInteger('inventory_item_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('inventory_items')
        .onDelete('SET NULL')
      table
        .bigInteger('stl_file_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('stl_files')
        .onDelete('SET NULL')
      // A Kiwix article URL/path the ZIM reader understands. Stored verbatim.
      table.string('zim_ref', 1024).nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Serves the detail page's "load this plan's steps in order" preload.
      table.index('plan_id', 'idx_scenario_steps_plan')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
