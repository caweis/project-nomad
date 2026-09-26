/**
 * Standalone checks for when a reply may be cancelled mid-generation.
 *
 *   node --experimental-strip-types tests/standalone/cancel_safety.standalone.ts
 *
 * Cancelling a reply on an Ollama build that predates the fix for upstream
 * #1321 leaves its runner spinning until restarted, which is worse than the
 * wasted answer cancelling was meant to save. These pin which side of that
 * line each backend and version falls on.
 */
import assert from 'node:assert/strict'
import {
  MIN_CANCEL_SAFE_OLLAMA,
  canCancelGeneration,
  parseOllamaVersion,
} from '../../app/utils/cancel_safety.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('the floor is the build upstream verified the fix on', () => {
  assert.equal(MIN_CANCEL_SAFE_OLLAMA, '0.33.3')
  assert.equal(canCancelGeneration('ollama', '0.33.3'), true)
})

check('builds before the floor keep running replies to the end', () => {
  // 0.24.0 is the build #1321 was reproduced on; 0.33.2 is one patch short.
  for (const version of ['0.24.0', '0.30.9', '0.33.2', '0.9.99']) {
    assert.equal(canCancelGeneration('ollama', version), false, version)
  }
})

check('later builds may cancel, including across a major or minor bump', () => {
  for (const version of ['0.33.4', '0.34.0', '0.40.1', '1.0.0']) {
    assert.equal(canCancelGeneration('ollama', version), true, version)
  }
})

check('an unset backend is ollama, and gets the same check', () => {
  assert.equal(canCancelGeneration(undefined, '0.24.0'), false)
  assert.equal(canCancelGeneration(undefined, '0.33.3'), true)
})

check('an unknown version fails closed', () => {
  // Unreachable, malformed, or a source build that calls itself 0.0.0: not
  // cancelling is how every earlier release behaved, so it is the safe side.
  for (const version of [null, '', 'unknown', '0.0.0']) {
    assert.equal(canCancelGeneration('ollama', version), false, String(version))
  }
})

check('the oMLX backend may cancel whatever the embed-only Ollama reports', () => {
  assert.equal(canCancelGeneration('omlx', null), true)
  assert.equal(canCancelGeneration('omlx', '0.24.0'), true)
})

check('version parsing takes the leading triple and nothing else', () => {
  assert.deepEqual(parseOllamaVersion('0.33.3'), [0, 33, 3])
  assert.deepEqual(parseOllamaVersion('v0.33.3'), [0, 33, 3])
  assert.deepEqual(parseOllamaVersion('0.34.0-rc1'), [0, 34, 0])
  assert.deepEqual(parseOllamaVersion(' 0.10.12 '), [0, 10, 12])
  assert.equal(parseOllamaVersion('0.33'), null)
  assert.equal(parseOllamaVersion(undefined), null)
})

check('minor versions compare as numbers, not strings', () => {
  // "0.4.0" sorts after "0.33.3" as a string; it is far older as a version.
  assert.equal(canCancelGeneration('ollama', '0.4.0'), false)
  assert.equal(canCancelGeneration('ollama', '0.100.0'), true)
})

console.log(`\n${passed} passed`)
