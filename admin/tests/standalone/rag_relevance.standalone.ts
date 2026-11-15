import assert from 'node:assert/strict'
import { applyRelevanceFloor, parseMinRelevance } from '../../app/utils/rag_relevance.ts'

assert.equal(parseMinRelevance(null, 0.62), 0.62)
assert.equal(parseMinRelevance('auto', 0.62), 0.62)
assert.equal(parseMinRelevance('garbage', 0.62), 0.62)
assert.equal(parseMinRelevance('0', 0.62), 0)
assert.equal(parseMinRelevance('0.66', 0.62), 0.66)
assert.equal(parseMinRelevance('Infinity', 0.62), 0.62)

const ranked = [
  { finalScore: 0.71, source: 'a' },
  { finalScore: 0.61, source: 'b' },
  { finalScore: 0.52, source: 'c' },
]
assert.deepEqual(applyRelevanceFloor(ranked, 0.62), {
  survivors: [ranked[0]],
  belowFloor: 2,
})
assert.deepEqual(applyRelevanceFloor(ranked, 0), { survivors: ranked, belowFloor: 0 })
assert.deepEqual(applyRelevanceFloor(ranked, 0.9), { survivors: [], belowFloor: 3 })

console.log('rag_relevance: 9 passed')
