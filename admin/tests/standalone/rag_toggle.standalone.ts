/**
 * Standalone test for the `rag.enabled` retrieval toggle (upstream #1247).
 *
 * The helper is pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/rag_toggle.standalone.ts
 *
 * Deliberately NOT a tests/unit/*.spec.ts: that glob is the Japa suite, and a
 * plain node:test file dropped there registers zero tests and still reports
 * green. The controller seam this guards (ollama_controller.chat) needs the
 * ignited Adonis container, so the testable part is the coercion — which is
 * also the part that can silently ship the wrong default.
 */
import assert from 'node:assert/strict'
import { isRagRetrievalEnabled } from '../../app/utils/rag_toggle.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── The default. This is the test that matters. ──
check('an unset key means retrieval is ON', () => {
  // KVStore.getValue returns null for a key that has never been written, which
  // is every install that predates the toggle.
  assert.equal(isRagRetrievalEnabled(null), true)
})

check('an undefined value means retrieval is ON', () => {
  // The chat header renders before useSystemSetting resolves; the switch must
  // not flash off and must not skip retrieval on a first message sent early.
  assert.equal(isRagRetrievalEnabled(undefined), true)
})

check('the ai.autoThinking coercion would get the default backwards', () => {
  // Guard against someone "harmonising" this with the neighbouring toggles.
  // That shape reads an absent key as OFF, which is the silent regression.
  const autoThinkingStyle = (v: unknown) => v === true || v === 'true'
  assert.equal(autoThinkingStyle(null), false)
  assert.notEqual(isRagRetrievalEnabled(null), autoThinkingStyle(null))
})

// ── Explicit values, in both the boolean and the string shape. ──
check('an explicit boolean false turns retrieval OFF', () => {
  assert.equal(isRagRetrievalEnabled(false), false)
})

check('an explicit boolean true turns retrieval ON', () => {
  assert.equal(isRagRetrievalEnabled(true), true)
})

check('the string "false" turns retrieval OFF', () => {
  // KV stores String(value) in a TEXT column, so this is the on-disk shape.
  assert.equal(isRagRetrievalEnabled('false'), false)
})

check('the string "true" turns retrieval ON', () => {
  assert.equal(isRagRetrievalEnabled('true'), true)
})

check('"0" and 0 turn retrieval OFF, "1" and 1 leave it ON', () => {
  assert.equal(isRagRetrievalEnabled('0'), false)
  assert.equal(isRagRetrievalEnabled(0), false)
  assert.equal(isRagRetrievalEnabled('1'), true)
  assert.equal(isRagRetrievalEnabled(1), true)
})

check('case and surrounding whitespace do not resurrect retrieval', () => {
  assert.equal(isRagRetrievalEnabled(' FALSE '), false)
  assert.equal(isRagRetrievalEnabled('False'), false)
})

// ── Anything unrecognised fails OPEN, never closed. ──
check('an unrecognised value leaves retrieval ON', () => {
  // A corrupt row must not be the reason the knowledge base goes quiet.
  assert.equal(isRagRetrievalEnabled('yes'), true)
  assert.equal(isRagRetrievalEnabled(''), true)
  assert.equal(isRagRetrievalEnabled({}), true)
})

console.log(`\n${passed} passed`)
