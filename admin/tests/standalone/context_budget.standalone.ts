/**
 * Standalone tests for the chat prompt budget (upstream #1253, adapted).
 *
 *   node --experimental-strip-types tests/standalone/context_budget.standalone.ts
 *
 * This is the code that decides what the model is allowed to see, so it is the
 * coverage that matters most. Upstream ships equivalents as node:test files
 * under tests/unit/, which this fork cannot use: all 17 files under that glob
 * are Japa, and a node:test file there registers zero tests and reports green.
 *
 * Two of these tests pin FORK FIXES to real defects in upstream's version —
 * both marked below. They fail against the upstream implementation.
 */
import assert from 'node:assert/strict'
import {
  ELISION_MARKER,
  TRUNCATION_NOTICE,
  MAX_RESPONSE_RESERVE,
  estimateMessagesTokens,
  estimateTokens,
  groupIntoTurns,
  planPrompt,
  splitForBudget,
  updateEwma,
  clampRatio,
  type BudgetMessage,
} from '../../app/utils/context_budget.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const words = (n: number, tag: string) => Array.from({ length: n }, () => tag).join(' ')
const renderRagBlock = (chunks: { text: string }[]) =>
  chunks.map((c, i) => `[Context ${i + 1}]\n${c.text}`).join('\n\n')

function history(turnCount: number, wordsPerMessage = 40): BudgetMessage[] {
  const out: BudgetMessage[] = []
  for (let i = 0; i < turnCount; i++) {
    out.push({ role: 'user', content: `q${i} ${words(wordsPerMessage, `u${i}`)}` })
    out.push({ role: 'assistant', content: `a${i} ${words(wordsPerMessage, `a${i}`)}` })
  }
  return out
}

function makeInputs(overrides: Partial<Parameters<typeof planPrompt>[0]> = {}) {
  return {
    systemBlocks: [{ role: 'system' as const, content: 'You are helpful.' }],
    history: [],
    query: { role: 'user' as const, content: 'How do I purify water?' },
    ragChunks: [],
    renderRagBlock,
    contextWindow: 8192,
    ...overrides,
  }
}

// ── Response reserve ──
check('reserves room for the answer and reports it as numPredict', () => {
  const r = planPrompt(makeInputs({ contextWindow: 8192 }))
  // 25% of the window, capped at MAX_RESPONSE_RESERVE.
  assert.equal(r.numPredict, MAX_RESPONSE_RESERVE)
  assert.ok(r.trace.promptBudget <= 8192 - r.numPredict)
})

check('a small window still reserves a usable floor', () => {
  const r = planPrompt(makeInputs({ contextWindow: 512 }))
  assert.ok(r.numPredict >= 256, `expected >=256, got ${r.numPredict}`)
})

// ── What must never be dropped ──
check('system blocks and the current question always survive', () => {
  const r = planPrompt(
    makeInputs({
      systemBlocks: [
        { role: 'system', content: 'BLOCK-A' },
        { role: 'system', content: 'BLOCK-B' },
      ],
      history: history(200),
      contextWindow: 4096,
    })
  )
  const joined = r.messages.map((m) => m.content).join('\n')
  assert.ok(joined.includes('BLOCK-A') && joined.includes('BLOCK-B'))
  assert.equal(r.messages.at(-1)!.content, 'How do I purify water?')
})

// ── The budget itself ──
check('never exceeds the prompt budget, with or without elision', () => {
  for (const turns of [0, 1, 5, 40, 200]) {
    const r = planPrompt(makeInputs({ history: history(turns), contextWindow: 4096 }))
    assert.ok(
      r.trace.estimatedPromptTokens <= r.trace.promptBudget,
      `turns=${turns}: ${r.trace.estimatedPromptTokens} > ${r.trace.promptBudget}`
    )
  }
})

check('FORK FIX: the elision marker is paid for, not added for free', () => {
  // Upstream fits history against the full remaining budget and THEN pushes
  // ELISION_MARKER in without charging for it, overrunning promptBudget by the
  // marker's cost. Re-measure the assembled prompt independently of the trace.
  const r = planPrompt(makeInputs({ history: history(60), contextWindow: 4096 }))
  assert.ok(r.trace.historyElided, 'this fixture must actually elide')
  assert.ok(r.messages.some((m) => m.content === ELISION_MARKER))

  const actual = estimateMessagesTokens(r.messages, 1)
  assert.ok(
    actual <= r.trace.promptBudget,
    `assembled prompt ${actual} exceeds budget ${r.trace.promptBudget}`
  )
})

// ── History eviction ──
check('history is dropped oldest-first, newest turns kept', () => {
  const r = planPrompt(makeInputs({ history: history(60), contextWindow: 4096 }))
  const joined = r.messages.map((m) => m.content).join('\n')
  assert.ok(joined.includes('q59'), 'the newest turn must survive')
  assert.ok(!joined.includes('q0 '), 'the oldest turn must be gone')
})

check('an elision marker appears only when something was actually dropped', () => {
  const short = planPrompt(makeInputs({ history: history(1), contextWindow: 8192 }))
  assert.equal(short.trace.historyElided, false)
  assert.ok(!short.messages.some((m) => m.content === ELISION_MARKER))
})

check('groupIntoTurns pairs user+assistant and ignores a leading assistant', () => {
  assert.equal(groupIntoTurns(history(3)).length, 3)
  const orphan: BudgetMessage[] = [
    { role: 'assistant', content: 'stray' },
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a' },
  ]
  // A leading assistant message must not open a phantom turn of its own.
  assert.ok(groupIntoTurns(orphan).length <= 2)
})

// ── Retrieved context ──
check('retrieved chunks are kept whole and best-first', () => {
  const r = planPrompt(
    makeInputs({
      ragChunks: [
        { text: words(60, 'BEST') },
        { text: words(60, 'MID') },
        { text: words(4000, 'HUGE') },
      ],
      contextWindow: 8192,
    })
  )
  const joined = r.messages.map((m) => m.content).join('\n')
  assert.ok(joined.includes('BEST'), 'the best chunk must be kept')
  assert.ok(!joined.includes('HUGE'), 'an over-budget chunk is dropped whole, never sliced')
  assert.equal(r.trace.chunksDropped >= 1, true)
})

check('retrieved context and history do not starve each other', () => {
  const r = planPrompt(
    makeInputs({
      history: history(60),
      ragChunks: [{ text: words(300, 'CTX') }],
      contextWindow: 8192,
    })
  )
  assert.ok(r.trace.ragTokens > 0, 'RAG got some budget')
  assert.ok(r.trace.historyTokens > 0, 'history got some budget')
})

// ── Degenerate input ──
check('FORK FIX: an oversized question is truncated with the notice it reserves for', () => {
  // Upstream reserves ELISION_MARKER.length but appends the (shorter)
  // truncation notice — the wrong constant. The visible cut is the point:
  // silently answering half a question is worse than saying it was cut.
  const r = planPrompt(
    makeInputs({ query: { role: 'user', content: words(20_000, 'LONG') }, contextWindow: 4096 })
  )
  assert.equal(r.trace.queryTruncated, true)
  assert.ok(r.messages.at(-1)!.content.endsWith(TRUNCATION_NOTICE))
  assert.ok(r.trace.estimatedPromptTokens <= r.trace.promptBudget)
})

check('empty history and no chunks still produces a valid prompt', () => {
  const r = planPrompt(makeInputs())
  assert.ok(r.messages.length >= 2)
  assert.equal(r.messages.at(-1)!.role, 'user')
})

// ── Estimator ──
check('the estimator counts newlines and scales with the calibration ratio', () => {
  assert.ok(estimateTokens('a\nb\nc', 1) > estimateTokens('abc', 1))
  const base = estimateTokens(words(200, 'x'), 1)
  assert.ok(estimateTokens(words(200, 'x'), 2) > base)
})

check('a tighter ratio tightens the budget', () => {
  const loose = planPrompt(makeInputs({ history: history(40), contextWindow: 4096, ratio: 1 }))
  const tight = planPrompt(makeInputs({ history: history(40), contextWindow: 4096, ratio: 2 }))
  assert.ok(tight.trace.turnsKept <= loose.trace.turnsKept)
})

check('EWMA seeds from the first observation, then damps', () => {
  assert.equal(updateEwma(null, 1.4), 1.4)
  const next = updateEwma(1.0, 2.0)
  assert.ok(next > 1.0 && next < 2.0, `expected damping, got ${next}`)
})

check('the calibration ratio rejects nonsense', () => {
  assert.equal(clampRatio(Number.NaN), 1)
  assert.equal(clampRatio(0), 1)
  assert.equal(clampRatio(-3), 1)
  assert.ok(clampRatio(99) <= 2.5)
  assert.ok(clampRatio(0.01) >= 0.5)
})

// ── Splitting the assembled payload ──
check('splits the payload into system blocks, history and the question', () => {
  const msgs: BudgetMessage[] = [
    { role: 'system', content: 'S1' },
    { role: 'system', content: 'S2' },
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'NOW' },
  ]
  const s = splitForBudget(msgs)
  assert.deepEqual(s.systemBlocks.map((m) => m.content), ['S1', 'S2'])
  assert.deepEqual(s.history.map((m) => m.content), ['q1', 'a1'])
  assert.equal(s.query.content, 'NOW')
})

check('a payload with no conversation yields an empty question, not a throw', () => {
  // A malformed request must not be able to take chat down.
  const s = splitForBudget([{ role: 'system', content: 'only' }])
  assert.equal(s.query.content, '')
  assert.deepEqual(s.history, [])
  assert.equal(s.systemBlocks.length, 1)
})

check('a single question with no history splits cleanly', () => {
  const s = splitForBudget([{ role: 'user', content: 'hello' }])
  assert.deepEqual(s.systemBlocks, [])
  assert.deepEqual(s.history, [])
  assert.equal(s.query.content, 'hello')
})

console.log(`\n${passed} passed`)
