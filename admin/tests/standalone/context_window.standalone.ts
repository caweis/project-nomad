/**
 * Standalone tests for context-window resolution (upstream #1253).
 *
 *   node --experimental-strip-types tests/standalone/context_window.standalone.ts
 *
 * This decides the num_ctx actually sent to the backend. Getting it too high
 * wastes memory or fails the load; too low silently truncates the conversation
 * from the middle, which is where retrieved context and recent history sit.
 *
 * Standalone rather than a tests/unit spec for the usual reason: that glob is
 * Japa, upstream's equivalents are node:test, and a node:test file there
 * registers zero tests and still reports green.
 */
import assert from 'node:assert/strict'
import {
  CONTEXT_LADDER,
  MIN_CONTEXT,
  UNKNOWN_BACKEND_CONTEXT,
  computeKvBytesPerToken,
  estimateKvBytesPerToken,
  parseParameterBillions,
  parseUserContextCap,
  readContextLength,
  readModelfileNumCtx,
  resolveContextWindow,
  snapToLadder,
} from '../../app/utils/context_window.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// A trimmed but real /api/show model_info for llama3:8b.
const LLAMA3_INFO: Record<string, unknown> = {
  'general.architecture': 'llama',
  'llama.context_length': 8192,
  'llama.block_count': 32,
  'llama.embedding_length': 4096,
  'llama.attention.head_count': 32,
  'llama.attention.head_count_kv': 8,
}

// ── Reading /api/show ──
check('reads trained context length via the architecture prefix', () => {
  assert.equal(readContextLength(LLAMA3_INFO), 8192)
})

check('readContextLength copes with a Map as well as a plain object', () => {
  // The ollama client types model_info as a Map; the wire format is an object.
  assert.equal(readContextLength(new Map(Object.entries(LLAMA3_INFO))), 8192)
})

check('readContextLength returns undefined rather than guessing', () => {
  assert.equal(readContextLength(undefined), undefined)
  assert.equal(readContextLength({}), undefined)
  assert.equal(readContextLength({ 'unrelated.key': 5 }), undefined)
})

check('falls back to any *.context_length when architecture is missing', () => {
  assert.equal(readContextLength({ 'qwen3.context_length': 32768 }), 32768)
})

check('reads num_ctx out of the modelfile parameters block', () => {
  assert.equal(readModelfileNumCtx('stop "<|eot|>"\nnum_ctx 4096\n'), 4096)
  assert.equal(readModelfileNumCtx('stop "<|eot|>"'), undefined)
  assert.equal(readModelfileNumCtx(undefined), undefined)
})

check('parses parameter size from details, falling back to the tag name', () => {
  assert.equal(parseParameterBillions('8.0B'), 8)
  assert.equal(parseParameterBillions(undefined, 'llama3:70b'), 70)
  assert.equal(parseParameterBillions(undefined, 'mystery'), undefined)
})

// ── KV cache sizing ──
check('uses grouped-query KV head count, not the attention head count', () => {
  // llama3:8b is GQA: 8 KV heads against 32 attention heads. Using 32 would
  // overestimate the cache by 4x and needlessly shrink the window.
  const exact = computeKvBytesPerToken(LLAMA3_INFO)
  assert.equal(exact, 2 * 32 * 8 * 128 * 2)
})

check('KV computation returns undefined on incomplete metadata', () => {
  assert.equal(computeKvBytesPerToken({ 'general.architecture': 'llama' }), undefined)
  assert.equal(computeKvBytesPerToken({}), undefined)
})

check('the KV fallback grows with parameter count', () => {
  const small = estimateKvBytesPerToken(3)
  const large = estimateKvBytesPerToken(70)
  assert.ok(large > small, `expected ${large} > ${small}`)
  assert.ok(estimateKvBytesPerToken(undefined) > 0, 'unknown size still gets a usable figure')
})

// ── The ladder ──
check('snaps down to a ladder rung, never up', () => {
  assert.equal(snapToLadder(8191), 4096)
  assert.equal(snapToLadder(8192), 8192)
  assert.equal(snapToLadder(100_000), 65536)
  assert.ok(CONTEXT_LADDER.includes(snapToLadder(999_999) as (typeof CONTEXT_LADDER)[number]))
})

check('snapping never returns below the floor', () => {
  assert.equal(snapToLadder(0), MIN_CONTEXT)
  assert.equal(snapToLadder(-1), MIN_CONTEXT)
})

// ── Resolution ──
check('the trained context is a hard ceiling', () => {
  const d = resolveContextWindow({ modelMaxCtx: 8192, kvBytesPerToken: 1024 })
  assert.ok(d.contextWindow <= 8192)
})

check('never exceeds trained context even to reach the floor', () => {
  // tinyllama trained at 2048 must get 2048, not a blind 4096 that would push
  // RoPE past anything the weights ever saw.
  const d = resolveContextWindow({ modelMaxCtx: 2048, kvBytesPerToken: 1024 })
  assert.equal(d.contextWindow, 2048)
  assert.equal(d.limitedBy, 'model')
})

check('a user cap only ever lowers the window', () => {
  const capped = resolveContextWindow({ modelMaxCtx: 131072, kvBytesPerToken: 1024, userCap: 8192 })
  assert.equal(capped.contextWindow, 8192)

  const overreach = resolveContextWindow({ modelMaxCtx: 8192, kvBytesPerToken: 1024, userCap: 131072 })
  assert.equal(overreach.contextWindow, 8192, 'a cap above the model must not raise it')
})

check('memory limits the window when the model would allow more', () => {
  const roomy = resolveContextWindow({
    modelMaxCtx: 131072,
    kvBytesPerToken: 131072,
    availableBytes: 32 * 1024 ** 3,
    modelBytes: 4 * 1024 ** 3,
  })
  const tight = resolveContextWindow({
    modelMaxCtx: 131072,
    kvBytesPerToken: 131072,
    availableBytes: 6 * 1024 ** 3,
    modelBytes: 4 * 1024 ** 3,
  })
  assert.ok(tight.contextWindow < roomy.contextWindow, 'less free memory must mean a smaller window')
})

check('falls back to a conservative default when nothing is known', () => {
  const d = resolveContextWindow({ kvBytesPerToken: 1024 })
  assert.equal(d.contextWindow, UNKNOWN_BACKEND_CONTEXT)
  assert.equal(d.limitedBy, 'default')
})

check('resolution is deterministic', () => {
  const inputs = { modelMaxCtx: 32768, kvBytesPerToken: 65536, availableBytes: 16 * 1024 ** 3 }
  assert.deepEqual(resolveContextWindow(inputs), resolveContextWindow(inputs))
})

// ── The user setting ──
check('parses the ai.contextWindow setting, treating auto as unset', () => {
  assert.equal(parseUserContextCap('auto'), undefined)
  assert.equal(parseUserContextCap(null), undefined)
  assert.equal(parseUserContextCap(undefined), undefined)
  assert.equal(parseUserContextCap(''), undefined)
  assert.equal(parseUserContextCap('banana'), undefined)
  assert.equal(parseUserContextCap('8192'), 8192)
})

console.log(`\n${passed} passed`)
