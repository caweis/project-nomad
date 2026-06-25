import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import {
  KV_STORE_SCHEMA,
  KV_STORE_TYPED_VALUES,
  type KVStoreKey,
  type KVStoreValue,
} from '../../types/kv_store.js'
import { parseBoolean } from '../utils/misc.js'

/** Keys whose stored string is a JSON document (object value type), not a scalar. */
function isJsonValuedKey(key: KVStoreKey): boolean {
  return key in KV_STORE_TYPED_VALUES
}

/**
 * Generic key-value store model for storing various settings
 * that don't necessitate their own dedicated models.
 */
export default class KVStore extends BaseModel {
  static table = 'kv_store'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: KVStoreKey

  @column()
  declare value: string | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  /**
   * Get a setting value by key, automatically deserializing to the correct type.
   */
  static async getValue<K extends KVStoreKey>(key: K): Promise<KVStoreValue<K> | null> {
    const setting = await this.findBy('key', key)
    if (!setting || setting.value === undefined || setting.value === null) {
      return null
    }
    const raw = String(setting.value)
    // JSON-valued keys (e.g. home.pins) deserialize the stored document; a
    // corrupt blob falls back to null so callers apply their documented default.
    if (isJsonValuedKey(key)) {
      try {
        return JSON.parse(raw) as KVStoreValue<K>
      } catch {
        return null
      }
    }
    return (KV_STORE_SCHEMA[key] === 'boolean' ? parseBoolean(raw) : raw) as KVStoreValue<K>
  }

  /**
   * Set a setting value by key (creates if not exists), automatically serializing to string.
   */
  static async setValue<K extends KVStoreKey>(key: K, value: KVStoreValue<K>): Promise<KVStore> {
    // JSON-valued keys (e.g. home.pins) store the JSON document; String(value)
    // would yield "[object Object]" for an object, so serialize explicitly.
    const serialized = isJsonValuedKey(key) ? JSON.stringify(value) : String(value)
    const setting = await this.firstOrCreate({ key }, { key, value: serialized })
    if (setting.value !== serialized) {
      setting.value = serialized
      await setting.save()
    }
    return setting
  }

  /**
   * Clear a setting value by key, storing null so getValue returns null.
   */
  static async clearValue<K extends KVStoreKey>(key: K): Promise<void> {
    const setting = await this.findBy('key', key)
    if (setting && setting.value !== null) {
      setting.value = null
      await setting.save()
    }
  }
}
