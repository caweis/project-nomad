import { DateTime } from 'luxon'

/**
 * Shared cool-off check for opt-in auto-update (core, apps, content).
 *
 * A newly-detected version is stamped with a "first seen" time
 * (`available_update_first_seen_at` for apps, the equivalent for content/core).
 * It only becomes eligible to auto-apply once `cooloffHours` have passed, so a
 * freshly-pushed release that turns out to be bad is not installed the same hour
 * it appears. A cool-off of 0 makes a seen version eligible immediately.
 */

/**
 * Whether the cool-off window has elapsed for a version first seen at `firstSeen`.
 * Returns false when nothing has been seen yet (null), when the timestamp is
 * malformed, or when it is in the future (clock-skew guard).
 */
export function isCooloffElapsed(
  firstSeen: string | DateTime | null,
  cooloffHours: number,
  now: DateTime = DateTime.now()
): boolean {
  if (firstSeen === null) return false

  const seen = typeof firstSeen === 'string' ? DateTime.fromISO(firstSeen) : firstSeen
  if (!seen.isValid) return false

  const elapsedHours = now.diff(seen, 'hours').hours
  if (elapsedHours < 0) return false // first-seen is in the future
  return elapsedHours >= cooloffHours
}
