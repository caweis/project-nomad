/**
 * Standalone test for the RAG context helpers (#rag-context-trust / b8961d2).
 *
 * Both helpers are pure, so they run under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/rag_context.standalone.ts
 */
import assert from 'node:assert/strict'
import { computeHeadingBoost, buildContextLabel } from '../../app/utils/rag_context.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── computeHeadingBoost ──
check('full heading-keyword overlap boosts by sqrt(1) * 0.1 * score', () => {
  // 2/2 keywords hit, score 0.5 -> sqrt(1) * 0.1 * 0.5 = 0.05
  assert.equal(computeHeadingBoost('Water Purification', ['water', 'purification'], 0.5), 0.05)
})

check('partial overlap scales by sqrt(ratio)', () => {
  // 1/2 hit, score 0.5 -> sqrt(0.5) * 0.1 * 0.5
  const b = computeHeadingBoost('Water Sources', ['water', 'fire'], 0.5)
  assert.ok(Math.abs(b - Math.sqrt(0.5) * 0.05) < 1e-9)
})

check('no heading-keyword hit means no boost', () => {
  assert.equal(computeHeadingBoost('Knot Tying', ['water', 'purification'], 0.5), 0)
})

check('an empty heading means no boost', () => {
  assert.equal(computeHeadingBoost('', ['water'], 0.5), 0)
})

// ── buildContextLabel ── (the bug: the raw relevance % primed models to distrust good context)
check('uses the source title and never the relevance score', () => {
  const label = buildContextLabel(0, { full_title: 'Water Purification' })
  assert.equal(label, '[Context 1 — Water Purification]')
  assert.ok(!label.includes('Relevance'))
  assert.ok(!label.includes('%'))
})

check('falls back to article_title, then to a bare label', () => {
  assert.equal(buildContextLabel(1, { article_title: 'First Aid' }), '[Context 2 — First Aid]')
  assert.equal(buildContextLabel(2, {}), '[Context 3]')
  assert.equal(buildContextLabel(2, undefined), '[Context 3]')
})

console.log(`\n${passed} passed`)
