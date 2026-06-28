/**
 * Standalone test for the shared cool-off helper (Phase 0).
 *
 *   node --experimental-strip-types tests/standalone/auto_update_cooloff.standalone.ts
 *
 * Cool-off makes a newly-seen version wait N hours before it is eligible to
 * auto-apply, so a freshly-pushed bad release isn't installed the same hour it
 * appears. Anchor = available_update_first_seen_at, stamped when an update is
 * first detected.
 */
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { isCooloffElapsed } from '../../app/utils/auto_update_cooloff.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const now = DateTime.fromObject({ year: 2026, month: 6, day: 28, hour: 12, minute: 0 })
const hoursAgo = (h: number) => now.minus({ hours: h })

check('elapsed when first-seen is older than the cool-off', () => {
  assert.equal(isCooloffElapsed(hoursAgo(49).toISO(), 48, now), true)
})
check('not elapsed when first-seen is newer than the cool-off', () => {
  assert.equal(isCooloffElapsed(hoursAgo(2).toISO(), 48, now), false)
})
check('boundary is inclusive (exactly cool-off hours ago is elapsed)', () => {
  assert.equal(isCooloffElapsed(hoursAgo(48).toISO(), 48, now), true)
})
check('cool-off of 0 is always elapsed when a version has been seen', () => {
  assert.equal(isCooloffElapsed(hoursAgo(0).toISO(), 0, now), true)
})
check('null first-seen is never elapsed (nothing seen yet)', () => {
  assert.equal(isCooloffElapsed(null, 48, now), false)
})
check('malformed first-seen is never elapsed', () => {
  assert.equal(isCooloffElapsed('not-a-date', 48, now), false)
})
check('a future first-seen is not elapsed (clock skew guard)', () => {
  assert.equal(isCooloffElapsed(now.plus({ hours: 5 }).toISO(), 1, now), false)
})
check('accepts a DateTime directly, not just an ISO string', () => {
  assert.equal(isCooloffElapsed(hoursAgo(49), 48, now), true)
})

console.log(`\n${passed} passed`)
