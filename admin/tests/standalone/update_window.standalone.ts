/**
 * Standalone test for the shared auto-update time-window helper (Phase 0).
 *
 *   node --experimental-strip-types tests/standalone/update_window.standalone.ts
 *
 * The window gates WHEN auto-updates may apply; the hourly job fires every hour
 * but only acts inside [windowStart, windowEnd), so a wrong predicate either
 * never updates or updates outside the user's chosen quiet hours.
 */
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { parseWindowMinutes, isWithinWindow } from '../../app/utils/update_window.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const at = (hour: number, minute: number) => DateTime.fromObject({ hour, minute })

// --- parseWindowMinutes ---
check('parses 00:00 to 0', () => assert.equal(parseWindowMinutes('00:00'), 0))
check('parses 02:30 to 150', () => assert.equal(parseWindowMinutes('02:30'), 150))
check('parses 23:59 to 1439', () => assert.equal(parseWindowMinutes('23:59'), 1439))
check('rejects 24:00 (out of range hour)', () => assert.equal(parseWindowMinutes('24:00'), null))
check('rejects 12:60 (out of range minute)', () => assert.equal(parseWindowMinutes('12:60'), null))
check('rejects 2:30 (unpadded)', () => assert.equal(parseWindowMinutes('2:30'), null))
check('rejects garbage', () => assert.equal(parseWindowMinutes('nope'), null))

// --- isWithinWindow: normal (start < end) ---
check('inside a normal window', () => assert.equal(isWithinWindow('02:00', '05:00', at(3, 0)), true))
check('start is inclusive', () => assert.equal(isWithinWindow('02:00', '05:00', at(2, 0)), true))
check('end is exclusive', () => assert.equal(isWithinWindow('02:00', '05:00', at(5, 0)), false))
check('before the window', () => assert.equal(isWithinWindow('02:00', '05:00', at(1, 59)), false))

// --- isWithinWindow: midnight wrap (start > end) ---
check('after start, wrapping past midnight', () => assert.equal(isWithinWindow('22:00', '02:00', at(23, 30)), true))
check('before end, wrapping past midnight', () => assert.equal(isWithinWindow('22:00', '02:00', at(1, 0)), true))
check('outside a wrapping window', () => assert.equal(isWithinWindow('22:00', '02:00', at(12, 0)), false))

// --- edge + malformed ---
check('zero-length window is never inside', () => assert.equal(isWithinWindow('03:00', '03:00', at(3, 0)), false))
check('malformed bound is never inside', () => assert.equal(isWithinWindow('bad', '05:00', at(3, 0)), false))

console.log(`\n${passed} passed`)
