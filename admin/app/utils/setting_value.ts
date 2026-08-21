import type { KVStoreKey } from '../../types/kv_store.js'

/**
 * Per-key value-format validation for settings keys that have constraints beyond
 * the generic key-enum check. Kept self-contained (only a type-only import, which
 * erases under `node --experimental-strip-types`) so it is standalone-testable;
 * the vine schemas in app/validators/settings.ts re-export this.
 *
 * Ported from upstream v1.33.0, minus the `system.internetStatusTestUrl` case
 * (not a key in our fork). Returns an error message when invalid, else null.
 */

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateSettingValue(key: KVStoreKey, value: unknown): string | null {
  switch (key) {
    case 'autoUpdate.windowStart':
    case 'autoUpdate.windowEnd':
    case 'contentAutoUpdate.windowStart':
    case 'contentAutoUpdate.windowEnd':
      if (typeof value !== 'string' || !HHMM_PATTERN.test(value)) {
        return 'Time window values must be in 24-hour HH:MM format (e.g. "20:00").'
      }
      return null
    case 'autoUpdate.cooloffHours':
    case 'contentAutoUpdate.cooloffHours': {
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 8760) {
        return 'Cool-off must be a whole number of hours between 0 and 8760.'
      }
      return null
    }
    case 'contentAutoUpdate.maxBytesPerWindow': {
      // Per-window download budget in bytes. 0 = unlimited.
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0) {
        return 'The per-window data cap must be a whole number of bytes (0 = unlimited).'
      }
      return null
    }
    case 'ui.homeLayout':
      if (value !== 'grid' && value !== 'decks') {
        return 'Home layout must be "grid" or "decks".'
      }
      return null
    case 'ai.tasksModel': {
      // A model name, or empty to mean "use the chat model" — SystemService
      // .updateSetting clears string keys on '' / null / undefined, and the
      // settings PATCH body makes `value` optional, so all three are valid.
      // Whether the name is installed and whether it clears the background-task
      // size cap are call-time decisions pickTasksModel makes against the live
      // model list, which a pure validator can't see. This only bounds the
      // shape so one bad caller can't store a blob where a model name belongs.
      if (value === undefined || value === null || value === '') {
        return null
      }
      if (typeof value !== 'string' || value.trim() === '') {
        return 'The tasks model must be a model name.'
      }
      if (value.length > 256) {
        return 'That tasks model name is too long to be a model name.'
      }
      return null
    }
    default:
      return null
  }
}
