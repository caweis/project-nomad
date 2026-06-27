/**
 * Standalone test for the chat-suggestion model chooser (#chat-model-select).
 *
 * `chooseSuggestionModel` is pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/chat_suggestion_model.standalone.ts
 */
import assert from 'node:assert/strict'
import { chooseSuggestionModel } from '../../app/utils/chat_suggestion_model.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const MODELS = [
  { name: 'llama3.1:405b', size: 400_000_000_000 },
  { name: 'qwen2.5:0.5b', size: 3_000_000_000 },
  { name: 'llama3.2:3b', size: 20_000_000_000 },
]

check('prefers the user-selected model regardless of size', () => {
  assert.equal(chooseSuggestionModel(MODELS, 'llama3.2:3b')?.name, 'llama3.2:3b')
})

// the regression: the old code picked the LARGEST model, which hangs the chat page
check('falls back to the SMALLEST model when none is selected', () => {
  assert.equal(chooseSuggestionModel(MODELS, null)?.name, 'qwen2.5:0.5b')
})

check('falls back to smallest when the selected model is no longer installed', () => {
  assert.equal(chooseSuggestionModel(MODELS, 'deepseek-r1:gone')?.name, 'qwen2.5:0.5b')
})

check('returns undefined for an empty model list', () => {
  assert.equal(chooseSuggestionModel([], 'anything'), undefined)
})

console.log(`\n${passed} passed`)
