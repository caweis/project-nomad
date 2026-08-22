/**
 * Standalone tests for the retrieval-eval scoring (upstream #1233, scoped).
 *
 *   node --experimental-strip-types tests/standalone/eval_retrieval.standalone.ts
 *
 * These metrics are how a retrieval change gets called better or worse, so a
 * quiet bug here is worse than no harness at all: it would hand back confident
 * numbers that point the wrong way.
 *
 * Standalone rather than a tests/unit spec for the usual reason — that glob is
 * Japa, upstream's equivalents are node:test, and a node:test file there
 * registers zero tests and still reports green.
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_K_VALUES,
  aggregate,
  hitRateAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  scoreCase,
  toDocumentRanking,
  type RetrievalCase,
} from '../../app/utils/eval/retrieval_metrics.ts'
import { GoldenSetError, parseGoldens } from '../../app/utils/eval/golden_set.ts'
import {
  docIdFromSource,
  stampsMatch,
  toScoredChunks,
  type RunStamp,
} from '../../app/utils/eval/retrieval_run.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const chunk = (docId: string | null, score = 0.5) => ({ docId, score })

// ── Ranking ──
check('a document ranks at its best chunk, and unresolved chunks drop out', () => {
  const ranking = toDocumentRanking([
    chunk(null),
    chunk('water'),
    chunk('fire'),
    chunk('water'), // second chunk of an already-ranked doc must not re-rank it
  ])
  assert.deepEqual(ranking, ['water', 'fire'])
})

// ── The metrics ──
check('recall counts how many relevant documents were found', () => {
  const retrieved = [chunk('a'), chunk('b'), chunk('c')]
  assert.equal(recallAtK(retrieved, ['a', 'b'], 3), 1)
  assert.equal(recallAtK(retrieved, ['a', 'z'], 3), 0.5)
  assert.equal(recallAtK(retrieved, ['z'], 3), 0)
})

check('recall respects the cut-off', () => {
  const retrieved = [chunk('a'), chunk('b'), chunk('c')]
  // 'c' sits at rank 3, so it is outside @2.
  assert.equal(recallAtK(retrieved, ['c'], 2), 0)
  assert.equal(recallAtK(retrieved, ['c'], 3), 1)
})

check('precision measures how much of what came back was wanted', () => {
  const retrieved = [chunk('a'), chunk('junk1'), chunk('junk2'), chunk('junk3')]
  assert.equal(precisionAtK(retrieved, ['a'], 4), 0.25)
})

check('hit rate is all-or-nothing per question', () => {
  const retrieved = [chunk('a'), chunk('b')]
  assert.equal(hitRateAtK(retrieved, ['b'], 2), 1)
  assert.equal(hitRateAtK(retrieved, ['zzz'], 2), 0)
})

check('reciprocal rank rewards putting the answer first', () => {
  assert.equal(reciprocalRank([chunk('a'), chunk('b')], ['a']), 1)
  assert.equal(reciprocalRank([chunk('a'), chunk('b')], ['b']), 0.5)
  assert.equal(reciprocalRank([chunk('a'), chunk('b')], ['zzz']), 0)
})

check('nDCG prefers the same documents ranked higher', () => {
  const good = ndcgAtK([chunk('a'), chunk('x'), chunk('y')], ['a'], 3)
  const worse = ndcgAtK([chunk('x'), chunk('y'), chunk('a')], ['a'], 3)
  assert.ok(good !== null && worse !== null)
  assert.ok(good! > worse!, `expected ${good} > ${worse}`)
})

check('a question with no relevant documents scores null, not zero', () => {
  // Null means "not applicable" and is excluded from the mean. Scoring it as a
  // zero would drag every average down and read as a regression.
  assert.equal(recallAtK([chunk('a')], [], 3), null)
  assert.equal(reciprocalRank([chunk('a')], []), null)
})

// ── Case scoring and aggregation ──
const makeCase = (over: Partial<RetrievalCase> = {}): RetrievalCase => ({
  id: 'c1',
  tags: ['single-hop'],
  retrieved: [chunk('water'), chunk('noise')],
  relevantDocIds: ['water'],
  expectRefusal: false,
  ...over,
})

check('scoreCase carries the case identity through to the result', () => {
  const r = scoreCase(makeCase(), DEFAULT_K_VALUES)
  assert.equal(r.id, 'c1')
  assert.deepEqual(r.tags, ['single-hop'])
  assert.equal(r.expectRefusal, false)
})

check('aggregating a perfect and a missed case lands in between', () => {
  const cases = [
    makeCase({ id: 'hit', retrieved: [chunk('water')], relevantDocIds: ['water'] }),
    makeCase({ id: 'miss', retrieved: [chunk('noise')], relevantDocIds: ['water'] }),
  ]
  const results = cases.map((c) => scoreCase(c, DEFAULT_K_VALUES))
  const agg = aggregate(cases, results, DEFAULT_K_VALUES)
  assert.equal(agg.cases, 2)
  assert.equal(agg.recall[1], 0.5)
  assert.equal(agg.answerable, 2)
})

// ── Golden set parsing ──
const GOOD = [
  JSON.stringify({ id: 'q1', query: 'How do I purify water?', relevantDocIds: ['water'] }),
  '// a comment line is skipped',
  '',
  JSON.stringify({ id: 'q2', query: 'Who won in 1998?', expectRefusal: true, tags: ['out-of-corpus'] }),
].join('\n')

check('parses a golden set, skipping blanks and comments', () => {
  const goldens = parseGoldens(GOOD, 'test')
  assert.equal(goldens.length, 2)
  assert.equal(goldens[0].id, 'q1')
  assert.deepEqual(goldens[0].relevantDocIds, ['water'])
  assert.equal(goldens[1].expectRefusal, true)
})

check('a typo fails loudly at load rather than scoring zero forever', () => {
  assert.throws(() => parseGoldens('{"query":"no id here"}', 'test'), GoldenSetError)
  assert.throws(() => parseGoldens('{not json}', 'test'), GoldenSetError)
  assert.throws(
    () => parseGoldens([GOOD, JSON.stringify({ id: 'q1', query: 'dup', relevantDocIds: ['x'] })].join('\n'), 'test'),
    GoldenSetError
  )
})

check('a refusal case may not also claim relevant documents', () => {
  // The two say opposite things about what good behaviour is.
  assert.throws(
    () => parseGoldens(JSON.stringify({ id: 'x', query: 'q', expectRefusal: true, relevantDocIds: ['a'] }), 'test'),
    GoldenSetError
  )
})

check('an answerable case with no relevant documents is refused', () => {
  assert.throws(() => parseGoldens(JSON.stringify({ id: 'x', query: 'q' }), 'test'), GoldenSetError)
})

check('an unparseable mustInclude regex is caught at load', () => {
  assert.throws(
    () => parseGoldens(JSON.stringify({ id: 'x', query: 'q', relevantDocIds: ['a'], mustInclude: ['('] }), 'test'),
    GoldenSetError
  )
})

// ── Mapping our retrieval results ──
check('a document id is the source basename without its extension', () => {
  assert.equal(docIdFromSource('/storage/kb/water-treatment.md'), 'water-treatment')
  assert.equal(docIdFromSource('water-treatment.md'), 'water-treatment')
  assert.equal(docIdFromSource('/storage/kb/notes.tar.gz'), 'notes.tar')
  assert.equal(docIdFromSource('/storage/kb/README'), 'README')
})

check('a missing or unusable source resolves to null, never to a guess', () => {
  assert.equal(docIdFromSource(undefined), null)
  assert.equal(docIdFromSource(null), null)
  assert.equal(docIdFromSource(42), null)
  assert.equal(docIdFromSource('   '), null)
  assert.equal(docIdFromSource('/'), null)
})

check('mapping preserves rank order and counts what it could not resolve', () => {
  const { chunks, unresolved } = toScoredChunks([
    { text: 'a', score: 0.9, metadata: { source: '/kb/first.md' } },
    { text: 'b', score: 0.8, metadata: {} },
    { text: 'c', score: 0.7, metadata: { source: '/kb/third.md' } },
  ])
  assert.deepEqual(chunks.map((c) => c.docId), ['first', null, 'third'])
  assert.deepEqual(chunks.map((c) => c.score), [0.9, 0.8, 0.7])
  assert.equal(unresolved, 1)
})

// ── Comparability ──
check('reports are comparable only when every retrieval parameter matches', () => {
  const base: RunStamp = {
    collection: 'Medicine',
    embeddingModel: 'nomic-embed-text:v1.5',
    topK: 10,
    scoreThreshold: 0.3,
  }
  assert.equal(stampsMatch(base, { ...base }), true)
  assert.equal(stampsMatch(base, { ...base, topK: 5 }), false)
  assert.equal(stampsMatch(base, { ...base, scoreThreshold: 0.4 }), false)
  assert.equal(stampsMatch(base, { ...base, collection: 'Repair' }), false)
  assert.equal(stampsMatch(base, { ...base, embeddingModel: 'other' }), false)
})

console.log(`\n${passed} passed`)
