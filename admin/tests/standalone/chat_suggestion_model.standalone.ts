/**
 * Standalone test for the chat-suggestion model chooser (#chat-model-select).
 *
 * `chooseSuggestionModel` is pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/chat_suggestion_model.standalone.ts
 */
import assert from 'node:assert/strict'
import {
  chooseSuggestionModel,
  effectiveSizeBytes,
  parseParamsBillion,
} from '../../app/utils/chat_suggestion_model.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const MODELS = [
  { name: 'llama3.1:405b', size: 400_000_000_000 },
  { name: 'qwen2.5:0.5b', size: 3_000_000_000 },
  { name: 'llama3.2:3b', size: 2_000_000_000 },
]

check('prefers the user-selected model when it is small enough', () => {
  assert.equal(chooseSuggestionModel(MODELS, 'qwen2.5:0.5b')?.name, 'qwen2.5:0.5b')
})

// the original regression: the old code picked the LARGEST model, which hangs the chat page
check('falls back to the smallest model when none is selected', () => {
  assert.equal(chooseSuggestionModel(MODELS, null)?.name, 'llama3.2:3b')
})

// the cap: a huge selected model is refused, not preferred
check('refuses a selected model over the size cap and picks the smallest instead', () => {
  assert.equal(chooseSuggestionModel(MODELS, 'llama3.1:405b')?.name, 'llama3.2:3b')
})

check('falls back to smallest when the selected model is no longer installed', () => {
  assert.equal(chooseSuggestionModel(MODELS, 'deepseek-r1:gone')?.name, 'llama3.2:3b')
})

check('returns undefined for an empty model list', () => {
  assert.equal(chooseSuggestionModel([], 'anything'), undefined)
})

// the live-appliance regression: oMLX reports size 0 for every model, so the
// old smallest-by-size reduce degenerated to first-in-list — the 32B model.
const OMLX_MODELS = [
  { name: 'deepseek-r1:32b', size: 0 },
  { name: 'gemma3:1b', size: 0 },
]

check('size 0 across the board: ranks by the name hint, not list order', () => {
  assert.equal(chooseSuggestionModel(OMLX_MODELS, null)?.name, 'gemma3:1b')
})

check('size 0: a huge lastModel is refused via its name hint', () => {
  assert.equal(chooseSuggestionModel(OMLX_MODELS, 'deepseek-r1:32b')?.name, 'gemma3:1b')
})

check('returns undefined when every model is over the cap', () => {
  const huge = [
    { name: 'deepseek-r1:32b', size: 0 },
    { name: 'llama3.1:405b', size: 400_000_000_000 },
  ]
  assert.equal(chooseSuggestionModel(huge, null), undefined)
})

check('size 0 with no name hint is treated as huge, never picked', () => {
  const mixed = [
    { name: 'mistral-nemo', size: 0 },
    { name: 'gemma3:1b', size: 0 },
  ]
  assert.equal(chooseSuggestionModel(mixed, null)?.name, 'gemma3:1b')
  assert.equal(chooseSuggestionModel([{ name: 'mistral-nemo', size: 0 }], null), undefined)
})

check('parseParamsBillion reads Ollama-style hints and rejects non-hints', () => {
  assert.equal(parseParamsBillion('gemma3:1b'), 1)
  assert.equal(parseParamsBillion('deepseek-r1:32b'), 32)
  assert.equal(parseParamsBillion('qwen2.5:0.5b'), 0.5)
  assert.equal(parseParamsBillion('gpt-oss:20b'), 20)
  assert.equal(parseParamsBillion('llama3.1:405b'), 405)
  assert.equal(parseParamsBillion('mistral-nemo'), null)
  assert.equal(parseParamsBillion('command-r7b'), null)
})

check('effectiveSizeBytes: a real reported size wins over the name hint', () => {
  assert.equal(effectiveSizeBytes({ name: 'gemma3:1b', size: 5_000_000_000 }), 5_000_000_000)
  assert.equal(effectiveSizeBytes({ name: 'gemma3:1b', size: 0 }), 700_000_000)
  assert.equal(
    effectiveSizeBytes({ name: 'mystery-model', size: 0 }),
    Number.POSITIVE_INFINITY
  )
})

console.log(`\n${passed} passed`)
