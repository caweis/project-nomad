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

/**
 * The context-window rungs accepted for `ai.contextWindow`.
 *
 * DUPLICATED ON PURPOSE from `context_window.ts`'s CONTEXT_LADDER. This module
 * keeps only type-only imports so it stays runnable under bare
 * `node --experimental-strip-types` (see the header), and a value import of the
 * real constant would break that. `settings_value_validator.standalone.ts`
 * asserts the two lists stay identical, so drift fails a test instead of
 * silently rejecting a window the resolver can produce.
 */
export const CONTEXT_LADDER = [4096, 8192, 16384, 32768, 65536, 131072] as const

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
    case 'ai.contextWindow': {
      // "auto" (or empty) hands the decision to ContextWindowService, which
      // sizes it per model from what /api/show reports. An explicit value is a
      // CEILING, never a floor: it can lower the window to save memory, and a
      // model that was not trained that long still wins, because running past
      // the trained length degrades the answer rather than extending it.
      //
      // Restricted to ladder rungs because Ollama unloads and reloads a model
      // whenever a request asks for a different num_ctx, so arbitrary values
      // would stall a turn and throw away the KV cache.
      if (value === undefined || value === null || value === '' || value === 'auto') {
        return null
      }
      const rung = Number(value)
      if (!CONTEXT_LADDER.includes(rung as (typeof CONTEXT_LADDER)[number])) {
        return `Context window must be "auto" or one of: ${CONTEXT_LADDER.join(', ')}.`
      }
      return null
    }
    default:
      return null
  }
}
