/**
 * Standalone test for the KB per-file ingest scan decision (RFC #883).
 *
 *   node --experimental-strip-types tests/standalone/kb_ingest_decision.standalone.ts
 *
 * The state row is authoritative; Qdrant chunk presence corroborates. Guards the
 * matrix that replaced the old binary "not in Qdrant → embed" check so a settled
 * or browse-only file isn't re-embedded, and Manual policy is honored.
 */
import assert from 'node:assert/strict'
import { decideScanAction } from '../../app/utils/kb_ingest_decision.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// no state row
check('no row + chunks in Qdrant → backfill_indexed', () => {
  assert.deepEqual(decideScanAction(null, true, 'Always'), { kind: 'backfill_indexed' })
})
check('no row + no chunks + Always → dispatch (create row)', () => {
  assert.deepEqual(decideScanAction(null, false, 'Always'), { kind: 'dispatch', createStateRow: true })
})
check('no row + no chunks + Manual → create_pending', () => {
  assert.deepEqual(decideScanAction(null, false, 'Manual'), { kind: 'create_pending' })
})

// indexed
check('indexed + chunks → skip', () => {
  assert.deepEqual(decideScanAction({ state: 'indexed' }, true), { kind: 'skip' })
})
check('indexed + no chunks → dispatch (row exists)', () => {
  assert.deepEqual(decideScanAction({ state: 'indexed' }, false), { kind: 'dispatch', createStateRow: false })
})

// pending_decision
check('pending + Always → dispatch (row exists)', () => {
  assert.deepEqual(decideScanAction({ state: 'pending_decision' }, false, 'Always'), {
    kind: 'dispatch',
    createStateRow: false,
  })
})
check('pending + Manual → skip (awaits user Index)', () => {
  assert.deepEqual(decideScanAction({ state: 'pending_decision' }, false, 'Manual'), { kind: 'skip' })
})

// settled / recovery states always skip
for (const state of ['browse_only', 'failed', 'stalled'] as const) {
  check(`${state} → skip`, () => {
    assert.deepEqual(decideScanAction({ state }, false, 'Always'), { kind: 'skip' })
    assert.deepEqual(decideScanAction({ state }, true, 'Always'), { kind: 'skip' })
  })
}

check('policy defaults to Always when omitted', () => {
  assert.deepEqual(decideScanAction(null, false), { kind: 'dispatch', createStateRow: true })
})

console.log(`\n${passed} passed`)
