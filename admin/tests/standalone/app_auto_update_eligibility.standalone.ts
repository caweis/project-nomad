/**
 * Standalone test for the per-app (container) auto-update eligibility (Phase 2).
 *
 *   node --experimental-strip-types tests/standalone/app_auto_update_eligibility.standalone.ts
 *
 * Two-layer consent (master AND per-app) plus same-major-only, cool-off, and
 * backoff. A regression that dropped either consent gate would auto-update apps
 * the user never opted into, so these guards are covered explicitly.
 */
import assert from 'node:assert/strict'
import { isAppAutoUpdateEligible } from '../../app/utils/app_auto_update_eligibility.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const base = {
  masterEnabled: true,
  perAppEnabled: true,
  withinWindow: true,
  hasUpdate: true,
  sameMajor: true,
  cooloffElapsed: true,
  consecutiveFailures: 0,
  disabledReason: null as string | null,
  maxFailures: 3,
}

check('eligible when everything is satisfied', () => {
  assert.equal(isAppAutoUpdateEligible(base).eligible, true)
})
check('not eligible when the master switch is off', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, masterEnabled: false }).eligible, false)
})
check('not eligible when the per-app toggle is off', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, perAppEnabled: false }).eligible, false)
})
check('not eligible outside the window', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, withinWindow: false }).eligible, false)
})
check('not eligible without an available update', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, hasUpdate: false }).eligible, false)
})
check('never auto-applies a major-version change', () => {
  const r = isAppAutoUpdateEligible({ ...base, sameMajor: false })
  assert.equal(r.eligible, false)
  assert.ok(!r.eligible && r.reason.includes('major'))
})
check('not eligible while auto-disabled', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, disabledReason: 'boom' }).eligible, false)
})
check('not eligible at the failure threshold', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, consecutiveFailures: 3 }).eligible, false)
})
check('not eligible during cool-off', () => {
  assert.equal(isAppAutoUpdateEligible({ ...base, cooloffElapsed: false }).eligible, false)
})

console.log(`\n${passed} passed`)
