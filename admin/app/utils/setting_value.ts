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
    default:
      return null
  }
}
