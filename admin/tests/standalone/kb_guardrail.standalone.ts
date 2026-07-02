/**
 * Standalone test for the KB auto-index guardrail decision (RFC #883 §7).
 *
 *   node --experimental-strip-types tests/standalone/kb_guardrail.standalone.ts
 *
 * Gates bulk-index commitments behind a confirmation at 50 GB absolute or 10%
 * of free disk. Wrong logic either nags on every tier change or lets an
 * off-grid box silently fill its disk with embeddings.
 */
import assert from 'node:assert/strict'
import {
  evaluateGuardrail,
  GUARDRAIL_ABSOLUTE_BYTES,
  GUARDRAIL_FREE_DISK_RATIO,
} from '../../inertia/lib/kb_guardrail.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const GiB = 1024 * 1024 * 1024

check('thresholds are 50 GB and 10%', () => {
  assert.equal(GUARDRAIL_ABSOLUTE_BYTES, 50 * GiB)
  assert.equal(GUARDRAIL_FREE_DISK_RATIO, 0.1)
})
check('small estimate with plenty of disk does not trip', () => {
  const v = evaluateGuardrail({ estimateBytes: 1 * GiB, freeBytes: 500 * GiB })
  assert.equal(v.trips, false)
  assert.equal(v.reasons.length, 0)
})
check('estimate at the absolute bound trips (inclusive)', () => {
  const v = evaluateGuardrail({ estimateBytes: 50 * GiB, freeBytes: 10_000 * GiB })
  assert.equal(v.trips, true)
  assert.ok(v.reasons.some((r) => r.kind === 'over_absolute'))
})
check('estimate at 10% of free disk trips (inclusive)', () => {
  const v = evaluateGuardrail({ estimateBytes: 10 * GiB, freeBytes: 100 * GiB })
  assert.equal(v.trips, true)
  assert.ok(v.reasons.some((r) => r.kind === 'over_free_disk'))
})
check('just under 10% of free disk does not trip', () => {
  const v = evaluateGuardrail({ estimateBytes: 9.9 * GiB, freeBytes: 100 * GiB })
  assert.equal(v.trips, false)
})
check('freeBytes 0 skips the relative check entirely', () => {
  const v = evaluateGuardrail({ estimateBytes: 49 * GiB, freeBytes: 0 })
  assert.equal(v.trips, false)
})
check('both thresholds can trip together', () => {
  const v = evaluateGuardrail({ estimateBytes: 60 * GiB, freeBytes: 100 * GiB })
  assert.equal(v.trips, true)
  assert.equal(v.reasons.length, 2)
})

console.log(`\n${passed} passed`)
