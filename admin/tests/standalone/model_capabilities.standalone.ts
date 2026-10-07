/**
 * Standalone checks for reading whether a model accepts images from /api/show
 * (upstream edbfe1ad and 26f40baf).
 *
 *   node --experimental-strip-types tests/standalone/model_capabilities.standalone.ts
 *
 * The case that matters most is the one where the honest answer is "unknown":
 * locking image upload because a placeholder said so would take the feature
 * away from every vision model on Apple MLX.
 */
import assert from 'node:assert/strict'
import {
  failureReason,
  unknownVisionFailureMessage,
  visionFromShow,
} from '../../app/utils/model_capabilities.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('Ollama listing vision means the model can see', () => {
  assert.equal(visionFromShow(['completion', 'vision'], 'ollama'), 'supported')
  assert.equal(visionFromShow(['completion', 'vision', 'tools', 'thinking'], 'ollama'), 'supported')
})

check('Ollama listing capabilities without vision means it cannot', () => {
  assert.equal(visionFromShow(['completion'], 'ollama'), 'unsupported')
  assert.equal(visionFromShow(['completion', 'tools', 'thinking'], 'ollama'), 'unsupported')
})

check('no backend named is treated as native Ollama', () => {
  assert.equal(visionFromShow(['completion', 'vision'], undefined), 'supported')
  assert.equal(visionFromShow(['completion'], undefined), 'unsupported')
})

check('an Ollama that reports no capabilities leaves it unknown, not refused', () => {
  // Builds from before the field existed return nothing, which is not a no.
  assert.equal(visionFromShow(undefined, 'ollama'), 'unknown')
  assert.equal(visionFromShow(null, 'ollama'), 'unknown')
  assert.equal(visionFromShow([], 'ollama'), 'unknown')
  assert.equal(visionFromShow('vision', 'ollama'), 'unknown')
  assert.equal(visionFromShow({ vision: true }, 'ollama'), 'unknown')
})

check('a capability list with anything but strings in it is not believed', () => {
  assert.equal(visionFromShow(['completion', 7], 'ollama'), 'unknown')
  assert.equal(visionFromShow([null], 'ollama'), 'unknown')
})

check("on Apple MLX the proxy's placeholder list never decides", () => {
  // The oMLX proxy answers ["completion"] for every model so the thinking check
  // has something to read. Believing it would disable images for all of them.
  assert.equal(visionFromShow(['completion'], 'omlx'), 'unknown')
  assert.equal(visionFromShow(undefined, 'omlx'), 'unknown')
  // Even a list that does say vision is left alone: on this backend the field is
  // not a statement about the model.
  assert.equal(visionFromShow(['completion', 'vision'], 'omlx'), 'unknown')
})

// ── When a picture request fails on a model that never said whether it can see ──
check("the failure message carries the backend's reason and names both causes", () => {
  const text = unknownVisionFailureMessage('mystery:7b', 'model requires more system memory')
  assert.match(text, /^The request failed \(model requires more system memory\)\./)
  assert.match(text, /cannot tell whether "mystery:7b" can see pictures/)
  assert.match(text, /try again without the picture/)
  assert.match(text, /not installed or is too large to load on this Mac/)
})

check('without a reason the message still reads as a sentence', () => {
  const text = unknownVisionFailureMessage('mystery:7b')
  assert.ok(text.startsWith('The request failed. It included a picture'))
  assert.ok(!text.includes('()'))
})

check('it does not tell the person to retype nothing: the box is already empty', () => {
  assert.ok(!/remove the image/i.test(unknownVisionFailureMessage('m')))
})

check('the reason is the error text on one line, cut short, or nothing', () => {
  assert.equal(failureReason(new Error('first line\n  second   line')), 'first line second line')
  assert.equal(failureReason(new Error('x'.repeat(500)))?.length, 200)
  assert.equal(failureReason(new Error('   ')), undefined)
  assert.equal(failureReason('not an Error'), undefined)
  assert.equal(failureReason(undefined), undefined)
})

console.log(`\n${passed} checks passed`)
