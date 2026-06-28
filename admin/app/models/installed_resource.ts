import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'

export default class InstalledResource extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare resource_id: string

  @column()
  declare resource_type: 'zim' | 'map'

  @column()
  declare collection_ref: string | null

  @column()
  declare version: string

  @column()
  declare url: string

  @column()
  declare file_path: string

  @column()
  declare file_size_bytes: number | null

  @column.dateTime()
  declare installed_at: DateTime

  // Content auto-update — a newer version detected by the check, held until its
  // cool-off elapses, plus the per-resource failure backoff. All null/0 until
  // the content auto-update tier writes them (migration 1778700000007).
  @column()
  declare available_update_version: string | null

  @column()
  declare available_update_size_bytes: number | null

  @column.dateTime()
  declare available_update_first_seen_at: DateTime | null

  @column()
  declare auto_update_consecutive_failures: number

  @column()
  declare auto_update_disabled_reason: string | null
}
