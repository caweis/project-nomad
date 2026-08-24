/**
 * Standalone tests for chat stream ownership (caweis#51).
 *
 *   node --experimental-strip-types tests/standalone/stream_abort.standalone.ts
 *
 * The effect wiring that calls these needs a browser to verify. These cover the
 * decisions underneath it: that an abandoned stream is actually aborted, and
 * that a straggler cannot clear the state of a reply still arriving.
 */
import assert from 'node:assert/strict'
import {
  abortActiveStream,
  claimStream,
  ownsStream,
  type ControllerRef,
} from '../../inertia/lib/stream_abort.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const ref = (c: AbortController | null = null): ControllerRef => ({ current: c })

// ── Aborting ──
check('an in-flight stream is actually aborted, and the slot cleared', () => {
  const controller = new AbortController()
  const r = ref(controller)
  assert.equal(abortActiveStream(r), true)
  assert.equal(controller.signal.aborted, true)
  assert.equal(r.current, null)
})

check('aborting when nothing is running is a no-op', () => {
  const r = ref(null)
  assert.equal(abortActiveStream(r), false)
  assert.equal(r.current, null)
})

check('an already-aborted controller is not aborted twice', () => {
  const controller = new AbortController()
  controller.abort()
  const r = ref(controller)
  // Reports false because it did not do anything, and still clears the slot.
  assert.equal(abortActiveStream(r), false)
  assert.equal(r.current, null)
})

// ── Ownership: the stale-stream bug ──
check('the current stream owns the shared state', () => {
  const controller = new AbortController()
  const r = ref(controller)
  assert.equal(ownsStream(r, controller), true)
})

check('a straggler does not own the state of a newer reply', () => {
  // This is the bug: the old stream's finally block used to clear the spinner
  // for a reply that was still arriving.
  const old = new AbortController()
  const r = ref(old)
  const fresh = claimStream(r)
  assert.equal(ownsStream(r, old), false)
  assert.equal(ownsStream(r, fresh), true)
})

check('nothing owns the state once the slot is empty', () => {
  const controller = new AbortController()
  const r = ref(controller)
  abortActiveStream(r)
  assert.equal(ownsStream(r, controller), false)
})

// ── Claiming ──
check('claiming a slot cancels the reply it replaces', () => {
  const old = new AbortController()
  const r = ref(old)
  const fresh = claimStream(r)
  assert.equal(old.signal.aborted, true, 'the superseded reply must be cancelled')
  assert.equal(fresh.signal.aborted, false, 'the new reply must start live')
  assert.equal(r.current, fresh)
})

check('claiming an empty slot just starts a stream', () => {
  const r = ref(null)
  const fresh = claimStream(r)
  assert.equal(fresh.signal.aborted, false)
  assert.equal(r.current, fresh)
})

console.log(`\n${passed} passed`)
