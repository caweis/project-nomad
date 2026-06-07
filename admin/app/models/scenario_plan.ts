import { DateTime } from 'luxon'
import { BaseModel, column, hasMany, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ScenarioPlanStep from './scenario_plan_step.js'
import type { Scenario } from '../../types/scenarios.js'

/**
 * Self-Reliance Suite — Scenario Plan (Phase 3).
 *
 * An editable, checkable per-scenario plan. The `scenario` column is a plain
 * varchar in the DB; its allowed values are enforced at the Vine validator layer
 * so the enum can grow without an ALTER TABLE (the inventory_items / stl_files
 * convention).
 *
 * hasMany steps — the steps live in their own table (scenario_plan_steps) so
 * each step's typed cross-link FKs and its mutable `checked` boolean are
 * first-class rows. Deleting a plan CASCADE-deletes its steps (FK in the
 * migration).
 */
export default class ScenarioPlan extends BaseModel {
  static table = 'scenario_plans'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare scenario: Scenario

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column.dateTime({ autoCreate: true, columnName: 'added_at' })
  declare added_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updated_at: DateTime

  @hasMany(() => ScenarioPlanStep, { foreignKey: 'plan_id', localKey: 'id' })
  declare steps: HasMany<typeof ScenarioPlanStep>
}
