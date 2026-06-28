/**
 * Standalone test for the content auto-update eligibility decision (Phase 1).
 *
 *   node --experimental-strip-types tests/standalone/content_update_eligibility.standalone.ts
 *
 * A pure combinator: given a resource's backoff state, whether its cool-off has
 * elapsed (computed by the caller via the shared cool-off helper), and the byte
 * budget, decide if it may auto-apply now. The job/window gating is the caller's.
 */
import assert from 'node:assert/strict'
import { isContentUpdateEligible } from '../../app/utils/content_update_eligibility.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const base = {
  cooloffElapsed: true,
  consecutiveFailures: 0,
  disabledReason: null as string | null,
  sizeBytes: 1_000_000,
  bytesUsedThisWindow: 0,
  maxBytesPerWindow: 0,
  maxFailures: 3,
}

check('eligible when cool-off elapsed, no backoff, cap unlimited', () => {
  assert.equal(isContentUpdateEligible(base).eligible, true)
})
check('not eligible while disabled', () => {
  assert.equal(isContentUpdateEligible({ ...base, disabledReason: 'boom' }).eligible, false)
})
check('not eligible at the failure threshold', () => {
  assert.equal(isContentUpdateEligible({ ...base, consecutiveFailures: 3 }).eligible, false)
})
check('not eligible during cool-off', () => {
  assert.equal(isContentUpdateEligible({ ...base, cooloffElapsed: false }).eligible, false)
})
check('cap of 0 means unlimited (large file still eligible)', () => {
  assert.equal(
    isContentUpdateEligible({ ...base, sizeBytes: 9_999_999_999, maxBytesPerWindow: 0 }).eligible,
    true
  )
})
check('eligible when this file fits under the remaining cap', () => {
  assert.equal(
    isContentUpdateEligible({ ...base, sizeBytes: 1_000, bytesUsedThisWindow: 500, maxBytesPerWindow: 2_000 }).eligible,
    true
  )
})
check('not eligible when this file would exceed the cap', () => {
  assert.equal(
    isContentUpdateEligible({ ...base, sizeBytes: 1_600, bytesUsedThisWindow: 500, maxBytesPerWindow: 2_000 }).eligible,
    false
  )
})
check('unknown size counts as 0 against the cap (still eligible)', () => {
  assert.equal(
    isContentUpdateEligible({ ...base, sizeBytes: null, bytesUsedThisWindow: 1_999, maxBytesPerWindow: 2_000 }).eligible,
    true
  )
})
check('a blocked result carries a non-empty reason', () => {
  const r = isContentUpdateEligible({ ...base, disabledReason: 'boom' })
  assert.ok(!r.eligible && typeof r.reason === 'string' && r.reason.length > 0)
})

console.log(`\n${passed} passed`)
