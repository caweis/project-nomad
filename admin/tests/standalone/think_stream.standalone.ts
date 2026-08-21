/**
 * Standalone test for the inline `<think>` splitter (ported from upstream #1253).
 *
 * The splitter is pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/think_stream.standalone.ts
 */
import assert from 'node:assert/strict'
import {
  ThinkTagSplitter,
  normalizeNonStreamed,
  partialTagSuffix,
  splitThinkTags,
} from '../../app/utils/think_stream.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── partialTagSuffix ──
check('counts the trailing chars that could still be the start of a tag', () => {
  assert.equal(partialTagSuffix('<think>', 'Hello <thi'), 4)
  assert.equal(partialTagSuffix('</think>', 'reasoning</'), 2)
  assert.equal(partialTagSuffix('<think>', 'a<'), 1)
  assert.equal(partialTagSuffix('<think>', 'Hello'), 0)
  assert.equal(partialTagSuffix('<think>', ''), 0)
})

check('a complete tag is not a partial one', () => {
  assert.equal(partialTagSuffix('<think>', '<think>'), 0)
})

// ── ThinkTagSplitter ── (the hard part: a tag can straddle a chunk boundary)
check('an opening tag split across chunks is still recognised', () => {
  const splitter = new ThinkTagSplitter()
  assert.deepEqual(splitter.push('Hello <thi'), { content: 'Hello ', thinking: '' })
  assert.deepEqual(splitter.push('nk>reasoning</think>World'), {
    content: 'World',
    thinking: 'reasoning',
  })
  assert.deepEqual(splitter.flush(), { content: '', thinking: '' })
})

check('a closing tag split across chunks returns to the content channel', () => {
  const splitter = new ThinkTagSplitter()
  assert.deepEqual(splitter.push('<think>why</thi'), { content: '', thinking: 'why' })
  assert.deepEqual(splitter.push('nk>because'), { content: 'because', thinking: '' })
})

// the truncation trap: a held-back partial that never completed was never a tag
check('a partial tag that never completes is flushed, not lost', () => {
  const answering = new ThinkTagSplitter()
  assert.deepEqual(answering.push('answer <thi'), { content: 'answer ', thinking: '' })
  assert.deepEqual(answering.flush(), { content: '<thi', thinking: '' })

  const reasoning = new ThinkTagSplitter()
  assert.deepEqual(reasoning.push('<think>deep</thi'), { content: '', thinking: 'deep' })
  assert.deepEqual(reasoning.flush(), { content: '', thinking: '</thi' })
})

check('a <think> the model never closes keeps its text off the content channel', () => {
  const splitter = new ThinkTagSplitter()
  assert.deepEqual(splitter.push('<think>still going'), { content: '', thinking: 'still going' })
  assert.deepEqual(splitter.flush(), { content: '', thinking: '' })
})

// ── splitThinkTags ──
check('content with no tags passes through untouched', () => {
  const answer = 'Boil water for one minute. 3 < 5 is still true.'
  assert.deepEqual(splitThinkTags(answer), { content: answer, thinking: '' })
})

check('every tag pair is extracted, not just the first', () => {
  assert.deepEqual(splitThinkTags('a<think>one</think>b<think>two</think>c'), {
    content: 'abc',
    thinking: 'onetwo',
  })
})

// ── normalizeNonStreamed ── (the sidebar-title and Qdrant-embedding leak)
check('merges native thinking with the tags found inline', () => {
  assert.deepEqual(normalizeNonStreamed('<think>inline</think>Answer', 'native '), {
    content: 'Answer',
    thinking: 'native inline',
  })
})

check('native-only and inline-only both normalise', () => {
  assert.deepEqual(normalizeNonStreamed('Answer', 'native'), {
    content: 'Answer',
    thinking: 'native',
  })
  assert.deepEqual(normalizeNonStreamed('<think>inline</think>Answer'), {
    content: 'Answer',
    thinking: 'inline',
  })
})

// ── empty input ──
check('empty input yields empty channels everywhere', () => {
  assert.deepEqual(splitThinkTags(''), { content: '', thinking: '' })
  assert.deepEqual(normalizeNonStreamed(''), { content: '', thinking: '' })
  const splitter = new ThinkTagSplitter()
  assert.deepEqual(splitter.push(''), { content: '', thinking: '' })
  assert.deepEqual(splitter.flush(), { content: '', thinking: '' })
})

console.log(`\n${passed} passed`)
