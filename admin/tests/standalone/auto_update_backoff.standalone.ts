/**
 * Standalone test for the shared failure-backoff decision (Phase 0).
 *
 *   node --experimental-strip-types tests/standalone/auto_update_backoff.standalone.ts
 *
 * A tier self-disables auto-update after MAX_CONSECUTIVE_FAILURES genuine
 * failures so a perpetually-broken update doesn't retry forever. Offline / busy
 * conditions are SKIPs and must NOT advance the counter (an off-grid box is
 * offline most of the time). This is the pure decision; persisting it to a
 * model/KV is the caller's job.
 */
import assert from 'node:assert/strict'
import { decideBackoff, MAX_CONSECUTIVE_FAILURES } from '../../app/utils/auto_update_backoff.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('threshold is 3', () => assert.equal(MAX_CONSECUTIVE_FAILURES, 3))

// success
check('success from a clean state changes nothing', () => {
  const r = decideBackoff({ outcome: 'success', currentFailures: 0, currentDisabledReason: null })
  assert.deepEqual(r, { failures: 0, disabledReason: null, changed: false })
})
check('success clears prior failures and disabled reason', () => {
  const r = decideBackoff({ outcome: 'success', currentFailures: 2, currentDisabledReason: 'x' })
  assert.deepEqual(r, { failures: 0, disabledReason: null, changed: true })
})

// skip (offline / busy) — never advances backoff
check('skip never advances the counter', () => {
  const r = decideBackoff({ outcome: 'skip', currentFailures: 1, currentDisabledReason: null })
  assert.deepEqual(r, { failures: 1, disabledReason: null, changed: false })
})
check('skip does not clear an existing disable', () => {
  const r = decideBackoff({ outcome: 'skip', currentFailures: 3, currentDisabledReason: 'boom' })
  assert.deepEqual(r, { failures: 3, disabledReason: 'boom', changed: false })
})

// failure
check('first failure increments without disabling', () => {
  const r = decideBackoff({ outcome: 'failure', currentFailures: 0, reason: 'pull failed' })
  assert.equal(r.failures, 1)
  assert.equal(r.disabledReason, null)
  assert.equal(r.changed, true)
})
check('second failure increments without disabling', () => {
  const r = decideBackoff({ outcome: 'failure', currentFailures: 1, reason: 'pull failed' })
  assert.equal(r.failures, 2)
  assert.equal(r.disabledReason, null)
})
check('third failure self-disables with the reason embedded', () => {
  const r = decideBackoff({ outcome: 'failure', currentFailures: 2, reason: 'registry 500' })
  assert.equal(r.failures, 3)
  assert.ok(r.disabledReason && r.disabledReason.includes('registry 500'))
  assert.ok(r.disabledReason && r.disabledReason.includes('3'))
  assert.equal(r.changed, true)
})
check('failure past the threshold keeps counting and stays disabled', () => {
  const r = decideBackoff({ outcome: 'failure', currentFailures: 3, reason: 'again' })
  assert.equal(r.failures, 4)
  assert.ok(r.disabledReason)
})

console.log(`\n${passed} passed`)
