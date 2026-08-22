/**
 * Standalone tests for the extracted chat prompt-budgeting helpers.
 *
 *   node --experimental-strip-types tests/standalone/rag_prompt.standalone.ts
 *
 * Deliberately NOT a tests/unit/*.spec.ts. All 17 files under that glob are
 * Japa (`import { test } from '@japa/runner'`); upstream's equivalents are
 * `node:test`. A node:test file dropped into that directory still gets loaded
 * by Japa's glob, registers ZERO tests, and reports green — the same silent
 * pass called out in the #1244 commit.
 *
 * These helpers came out of OllamaController.chat, where they were inline and
 * untestable. The point of this file is to pin the behaviour BEFORE the context
 * budget lands on top of it, so any later change to what the model sees is a
 * visible diff rather than a silent one.
 */
import assert from 'node:assert/strict'
import {
  PROMPT_CHARS_PER_TOKEN,
  getContextLimitsForModel,
  trimToContextBudget,
} from '../../app/utils/rag_prompt.ts'
import { buildContextBlock, buildContextLabel } from '../../app/utils/rag_context.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// The tiers as the controller supplies them (constants/ollama.ts RAG_CONTEXT_LIMITS).
const TIERS = [
  { maxParams: 3, maxResults: 2, maxTokens: 1000 },
  { maxParams: 8, maxResults: 4, maxTokens: 2500 },
  { maxParams: Number.POSITIVE_INFINITY, maxResults: 5, maxTokens: 0 },
]

const chunk = (text: string, metadata?: Record<string, any>) => ({ text, metadata })

// ── Model-size tiering ──
check('parses the parameter count out of a tagged model name', () => {
  assert.deepEqual(getContextLimitsForModel('llama3.2:3b', TIERS), { maxResults: 2, maxTokens: 1000 })
  assert.deepEqual(getContextLimitsForModel('qwen2.5:1.5b', TIERS), { maxResults: 2, maxTokens: 1000 })
  assert.deepEqual(getContextLimitsForModel('gemma:7b', TIERS), { maxResults: 4, maxTokens: 2500 })
})

check('a large model gets the uncapped tier', () => {
  assert.deepEqual(getContextLimitsForModel('llama3:70b', TIERS), { maxResults: 5, maxTokens: 0 })
  assert.deepEqual(getContextLimitsForModel('deepseek-r1:32b', TIERS), { maxResults: 5, maxTokens: 0 })
})

check('tier boundaries are inclusive on maxParams', () => {
  // 3B lands in the 1-3B tier, not the 4-8B one; 8B lands in 4-8B, not 13B+.
  assert.deepEqual(getContextLimitsForModel('x:3b', TIERS), { maxResults: 2, maxTokens: 1000 })
  assert.deepEqual(getContextLimitsForModel('x:8b', TIERS), { maxResults: 4, maxTokens: 2500 })
})

check('PRESERVED QUIRK: an unparseable name is treated as 8B', () => {
  // This is a guess, and it hands "phi3" the 4-8B budget it may not be able to
  // hold. Pinned here so that if it is ever fixed, it is fixed deliberately.
  assert.deepEqual(getContextLimitsForModel('phi3', TIERS), { maxResults: 4, maxTokens: 2500 })
  assert.deepEqual(getContextLimitsForModel('mistral-nemo', TIERS), { maxResults: 4, maxTokens: 2500 })
})

check('the first B-like token in the name wins', () => {
  // "llama3.2:3b" must read 3, not 3.2 — the regex is anchored on the [bB].
  assert.deepEqual(getContextLimitsForModel('llama3.2:3b', TIERS), { maxResults: 2, maxTokens: 1000 })
})

// ── Trimming ──
check('caps the number of results before anything else', () => {
  const docs = [chunk('a'), chunk('b'), chunk('c'), chunk('d'), chunk('e')]
  assert.equal(trimToContextBudget(docs, { maxResults: 2, maxTokens: 0 }).length, 2)
})

check('maxTokens of 0 means no character cap', () => {
  const docs = [chunk('x'.repeat(50_000)), chunk('y'.repeat(50_000))]
  const kept = trimToContextBudget(docs, { maxResults: 5, maxTokens: 0 })
  assert.equal(kept.length, 2)
})

check('the most relevant result is always kept, however large', () => {
  // A single oversized chunk must never starve the model of context entirely.
  const docs = [chunk('x'.repeat(100_000)), chunk('small')]
  const kept = trimToContextBudget(docs, { maxResults: 5, maxTokens: 1000 })
  assert.equal(kept.length, 1)
  assert.equal(kept[0].text.length, 100_000)
})

check('subsequent results are dropped once the character cap is passed', () => {
  const cap = 1000 * PROMPT_CHARS_PER_TOKEN // 4000 chars
  const docs = [chunk('a'.repeat(100)), chunk('b'.repeat(100)), chunk('c'.repeat(cap))]
  const kept = trimToContextBudget(docs, { maxResults: 5, maxTokens: 1000 })
  assert.deepEqual(kept.map((d) => d.text[0]), ['a', 'b'])
})

check('PRESERVED QUIRK: the chunk that crosses the cap still counts against it', () => {
  // totalChars is incremented BEFORE the test, so an over-cap chunk is excluded
  // yet still consumes budget — a later small chunk can be starved by a big one
  // that was itself dropped. Faithful to the pre-extraction behaviour.
  const docs = [chunk('a'.repeat(10)), chunk('b'.repeat(100_000)), chunk('c')]
  const kept = trimToContextBudget(docs, { maxResults: 5, maxTokens: 1000 })
  assert.deepEqual(kept.map((d) => d.text[0]), ['a'])
})

check('an empty result set trims to nothing without throwing', () => {
  assert.deepEqual(trimToContextBudget([], { maxResults: 5, maxTokens: 2500 }), [])
})

// ── Rendering (lives in rag_context.ts beside the label rule) ──
check('context blocks are labelled by source title, never by score', () => {
  const block = buildContextBlock([
    chunk('Boil water for one minute.', { full_title: 'Water Treatment' }),
    chunk('Filter first if turbid.', { article_title: 'Turbidity' }),
    chunk('Unlabelled passage.'),
  ])
  assert.equal(
    block,
    '[Context 1 — Water Treatment]\nBoil water for one minute.\n\n' +
      '[Context 2 — Turbidity]\nFilter first if turbid.\n\n' +
      '[Context 3]\nUnlabelled passage.'
  )
  assert.ok(!/\d+%/.test(block), 'a relevance score must never reach the prompt')
})

check('buildContextBlock agrees with buildContextLabel', () => {
  // One rule for how a block is presented, not two.
  const docs = [chunk('body', { full_title: 'Title' })]
  assert.ok(buildContextBlock(docs).startsWith(buildContextLabel(0, { full_title: 'Title' })))
})

check('an empty chunk list renders an empty block', () => {
  assert.equal(buildContextBlock([]), '')
})

console.log(`\n${passed} passed`)
