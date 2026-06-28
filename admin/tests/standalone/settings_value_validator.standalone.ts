/**
 * Standalone test for the settings value-format validator (Phase 0).
 *
 *   node --experimental-strip-types tests/standalone/settings_value_validator.standalone.ts
 *
 * The generic schema only constrains the settings KEY; this guards the VALUE for
 * the auto-update keys (HH:MM windows, 0-8760h cool-off, >=0 byte cap) so a bad
 * value is rejected with 422 before it reaches the KV store and the scheduler.
 */
import assert from 'node:assert/strict'
import { validateSettingValue } from '../../app/utils/setting_value.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const ok = (k: any, v: unknown) => assert.equal(validateSettingValue(k, v), null)
const bad = (k: any, v: unknown) => assert.ok(typeof validateSettingValue(k, v) === 'string')

// window HH:MM
check('accepts a valid window start', () => ok('autoUpdate.windowStart', '20:00'))
check('accepts midnight', () => ok('autoUpdate.windowEnd', '00:00'))
check('accepts 23:59', () => ok('contentAutoUpdate.windowStart', '23:59'))
check('rejects 24:00', () => bad('autoUpdate.windowStart', '24:00'))
check('rejects unpadded 2:00', () => bad('autoUpdate.windowEnd', '2:00'))
check('rejects non-string window', () => bad('contentAutoUpdate.windowEnd', 1200))
check('rejects garbage window', () => bad('autoUpdate.windowStart', 'evening'))

// cool-off hours
check('accepts cool-off 0', () => ok('autoUpdate.cooloffHours', '0'))
check('accepts cool-off 48', () => ok('contentAutoUpdate.cooloffHours', 48))
check('accepts cool-off 8760 (one year)', () => ok('autoUpdate.cooloffHours', '8760'))
check('rejects cool-off > 8760', () => bad('autoUpdate.cooloffHours', '8761'))
check('rejects negative cool-off', () => bad('contentAutoUpdate.cooloffHours', '-1'))
check('rejects fractional cool-off', () => bad('autoUpdate.cooloffHours', '2.5'))

// per-window byte cap
check('accepts cap 0 (unlimited)', () => ok('contentAutoUpdate.maxBytesPerWindow', '0'))
check('accepts a large byte cap', () => ok('contentAutoUpdate.maxBytesPerWindow', String(5 * 1024 ** 3)))
check('rejects negative cap', () => bad('contentAutoUpdate.maxBytesPerWindow', '-5'))
check('rejects fractional cap', () => bad('contentAutoUpdate.maxBytesPerWindow', '1.5'))

// keys without a value constraint pass through
check('enabled toggle has no value constraint', () => ok('autoUpdate.enabled', true))
check('an unconstrained key passes through', () => ok('chat.lastModel', 'llama3.2:1b'))

console.log(`\n${passed} passed`)
