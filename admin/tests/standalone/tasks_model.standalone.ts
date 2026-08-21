/**
 * Standalone test for the ancillary-tasks model decision (upstream #1244).
 *
 * `pickTasksModel` is pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/tasks_model.standalone.ts
 *
 * Upstream ships this as a node:test spec under tests/unit/. That file would
 * register zero tests here — every file matched by this fork's Japa glob is
 * @japa/runner — so a node:test port would report green while asserting
 * nothing. Hence the standalone harness.
 *
 * The case that matters most to this fork is the last group: upstream's
 * pickTasksModel gates on installed-ness alone, so on the oMLX backend (every
 * model reports size 0) an explicitly picked 32B would walk straight past
 * SUGGESTION_MODEL_MAX_BYTES into the load-wedge that cap exists to prevent.
 */
import assert from 'node:assert/strict'
import {
  pickTasksModel,
  SUGGESTION_MODEL_MAX_BYTES,
} from '../../app/utils/chat_suggestion_model.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// Ollama-style: real reported sizes. gpt-oss:20b is deliberately over the cap.
const INSTALLED = [
  { name: 'llama3.1:8b', size: 4_700_000_000 },
  { name: 'qwen2.5:3b', size: 1_900_000_000 },
  { name: 'gpt-oss:20b', size: 13_000_000_000 },
]

check('unset setting falls back to the caller default', () => {
  assert.deepEqual(pickTasksModel(null, INSTALLED, 'llama3.1:8b'), {
    model: 'llama3.1:8b',
    staleConfigured: null,
    oversizedConfigured: null,
  })
  assert.equal(pickTasksModel(undefined, INSTALLED, 'llama3.1:8b').model, 'llama3.1:8b')
})

check('empty and whitespace-only settings count as unset', () => {
  // SystemService.updateSetting clears the row on an empty string, but a value
  // written before that behaviour (or by hand) must not select a "" model.
  assert.equal(pickTasksModel('', INSTALLED, 'llama3.1:8b').model, 'llama3.1:8b')
  assert.equal(pickTasksModel('   ', INSTALLED, 'llama3.1:8b').model, 'llama3.1:8b')
})

check('a configured, installed, in-cap model wins over the chat model', () => {
  assert.deepEqual(pickTasksModel('qwen2.5:3b', INSTALLED, 'gpt-oss:20b'), {
    model: 'qwen2.5:3b',
    staleConfigured: null,
    oversizedConfigured: null,
  })
})

check('surrounding whitespace is trimmed before matching', () => {
  assert.equal(pickTasksModel('  qwen2.5:3b  ', INSTALLED, 'gpt-oss:20b').model, 'qwen2.5:3b')
})

check('an uninstalled configured model falls back and reports itself stale', () => {
  // The user deleted the model from /settings/models after selecting it here.
  // Requesting it would 404, so the caller's fallback runs and the name comes
  // back for the warning log.
  assert.deepEqual(pickTasksModel('llama3.2:1b', INSTALLED, 'llama3.1:8b'), {
    model: 'llama3.1:8b',
    staleConfigured: 'llama3.2:1b',
    oversizedConfigured: null,
  })
})

check('model names match exactly, not by prefix', () => {
  // "llama3.1" is a family, not an installed tag; only "llama3.1:8b" is pullable.
  assert.equal(pickTasksModel('llama3.1', INSTALLED, 'qwen2.5:3b').model, 'qwen2.5:3b')
})

check('nothing installed falls back and reports stale', () => {
  assert.deepEqual(pickTasksModel('qwen2.5:3b', [], 'llama3.1:8b'), {
    model: 'llama3.1:8b',
    staleConfigured: 'qwen2.5:3b',
    oversizedConfigured: null,
  })
})

check('a null fallback stays null', () => {
  // getChatSuggestions has no model to fall back to when nothing is installed.
  assert.deepEqual(pickTasksModel(null, [], null), {
    model: null,
    staleConfigured: null,
    oversizedConfigured: null,
  })
  assert.equal(pickTasksModel('qwen2.5:3b', [], null).model, null)
})

// ---------------------------------------------------------------------------
// The fork's seam: the size cap still applies to an EXPLICIT pick.
// ---------------------------------------------------------------------------

check('an installed but over-cap pick is refused, not honoured', () => {
  assert.deepEqual(pickTasksModel('gpt-oss:20b', INSTALLED, 'llama3.1:8b'), {
    model: 'llama3.1:8b',
    staleConfigured: null,
    oversizedConfigured: 'gpt-oss:20b',
  })
})

check('an over-cap pick is distinguishable from an uninstalled one', () => {
  // Different operator advice: "pick a smaller model" vs "reinstall it".
  const oversized = pickTasksModel('gpt-oss:20b', INSTALLED, 'llama3.1:8b')
  const stale = pickTasksModel('never-installed:70b', INSTALLED, 'llama3.1:8b')
  assert.equal(oversized.staleConfigured, null)
  assert.equal(stale.oversizedConfigured, null)
})

// The live-appliance regression, in the shape this port could have reopened:
// oMLX reports size 0 for every model, so a size-only gate reads a 32B as free.
const OMLX_INSTALLED = [
  { name: 'deepseek-r1:32b', size: 0 },
  { name: 'gemma3:1b', size: 0 },
]

check('oMLX size 0: an over-cap pick is caught by the name hint, not the size', () => {
  assert.deepEqual(pickTasksModel('deepseek-r1:32b', OMLX_INSTALLED, 'gemma3:1b'), {
    model: 'gemma3:1b',
    staleConfigured: null,
    oversizedConfigured: 'deepseek-r1:32b',
  })
})

check('oMLX size 0: a small pick is still honoured', () => {
  assert.equal(pickTasksModel('gemma3:1b', OMLX_INSTALLED, 'deepseek-r1:32b').model, 'gemma3:1b')
})

check('oMLX size 0 with no parameter hint is treated as huge and refused', () => {
  // effectiveSizeBytes returns Infinity for an unrankable name, so an unknown
  // model is never quietly loaded for background work.
  const unknown = [{ name: 'mistral-nemo', size: 0 }]
  assert.deepEqual(pickTasksModel('mistral-nemo', unknown, 'gemma3:1b'), {
    model: 'gemma3:1b',
    staleConfigured: null,
    oversizedConfigured: 'mistral-nemo',
  })
})

check('a model exactly at the cap is allowed; one byte over is refused', () => {
  const atCap = [{ name: 'edge:at-cap', size: SUGGESTION_MODEL_MAX_BYTES }]
  const overCap = [{ name: 'edge:over-cap', size: SUGGESTION_MODEL_MAX_BYTES + 1 }]
  assert.equal(pickTasksModel('edge:at-cap', atCap, 'fallback').model, 'edge:at-cap')
  assert.equal(pickTasksModel('edge:over-cap', overCap, 'fallback').model, 'fallback')
})

check('an over-cap pick with a null fallback yields null, never the big model', () => {
  // Better to skip the ancillary task than to cold-load a model that wedges it.
  assert.deepEqual(pickTasksModel('gpt-oss:20b', INSTALLED, null), {
    model: null,
    staleConfigured: null,
    oversizedConfigured: 'gpt-oss:20b',
  })
})

console.log(`\n${passed} passed`)
