import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ScenarioPlan from './scenario_plan.js'
import InventoryItem from './inventory_item.js'
import StlFile from './stl_file.js'

/**
 * Self-Reliance Suite — Scenario Plan step (Phase 3).
 *
 * One ordered, checkable step within a plan, carrying AT MOST ONE optional typed
 * cross-link (inventory item / STL file / ZIM article). The link is identified
 * by which of the three nullable fields is set; the pure helper resolveStepLink
 * turns the fields into a navigable { kind, href }.
 *
 * belongsTo keys are spelled out explicitly and CORRECTLY (foreignKey is the
 * column on THIS table, localKey is the PK on the related table) — the
 * ChatMessage.session fix proved an inverted pair silently mis-joins. The step
 * belongsTo its plan via the local plan_id column → scenario_plans.id, and
 * optionally belongsTo a linked InventoryItem / StlFile via their *_id columns.
 *
 * The inventory/STL relations are nullable at the DB level (onDelete SET NULL):
 * deleting a linked target degrades the step's link to "unlinked" rather than
 * breaking the plan.
 */
export default class ScenarioPlanStep extends BaseModel {
  static table = 'scenario_plan_steps'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare plan_id: number

  @column()
  declare position: number

  @column()
  declare text: string

  @column()
  declare checked: boolean

  @column()
  declare inventory_item_id: number | null

  @column()
  declare stl_file_id: number | null

  /** A Kiwix article URL/path the ZIM reader understands. Stored verbatim. */
  @column()
  declare zim_ref: string | null

  /**
   * Snapshot of the linked target's display name at link time. Preserved when the
   * FK is SET NULL'd on target deletion so the UI can show "was: <name>" rather
   * than blanking the step's link info entirely.
   */
  @column()
  declare linked_name_snapshot: string | null

  @column.dateTime({ autoCreate: true, columnName: 'added_at' })
  declare added_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  // foreignKey = column on THIS table; localKey = PK on the related table.
  @belongsTo(() => ScenarioPlan, { foreignKey: 'plan_id', localKey: 'id' })
  declare plan: BelongsTo<typeof ScenarioPlan>

  @belongsTo(() => InventoryItem, { foreignKey: 'inventory_item_id', localKey: 'id' })
  declare inventoryItem: BelongsTo<typeof InventoryItem>

  @belongsTo(() => StlFile, { foreignKey: 'stl_file_id', localKey: 'id' })
  declare stlFile: BelongsTo<typeof StlFile>
}
