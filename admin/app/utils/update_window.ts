import { DateTime } from 'luxon'

/**
 * Shared update-window helpers used by all three opt-in auto-update tiers
 * (core, apps, content). The hourly auto-update job fires every hour but only
 * acts when `now` is inside the user's configured window, so the cron cadence
 * is decoupled from the window length.
 *
 * The window is interpreted in the container's local time (set via the TZ env
 * var). Windows that wrap past midnight (start > end, e.g. 22:00-02:00) are
 * supported. Ported from upstream v1.33.0 (admin/app/utils/update_window.ts).
 */

/** Parse an "HH:MM" 24-hour string into minutes-since-midnight, or null if malformed. */
export function parseWindowMinutes(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Whether `now` falls inside the [windowStart, windowEnd) window (handles midnight wrap). */
export function isWithinWindow(
  windowStart: string,
  windowEnd: string,
  now: DateTime = DateTime.now()
): boolean {
  const start = parseWindowMinutes(windowStart)
  const end = parseWindowMinutes(windowEnd)
  if (start === null || end === null) return false

  const current = now.hour * 60 + now.minute
  if (start === end) return false // zero-length window
  if (start < end) {
    return current >= start && current < end
  }
  // Wraps midnight
  return current >= start || current < end
}
