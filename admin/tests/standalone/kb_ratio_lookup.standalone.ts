/**
 * Standalone test for the KB embedding-cost ratio lookup (RFC #883).
 *
 *   node --experimental-strip-types tests/standalone/kb_ratio_lookup.standalone.ts
 *
 * Longest-prefix match with an optional catch-all, and disk-cost estimates users
 * see before a large ingest. Getting the match wrong mis-estimates disk/time.
 */
import assert from 'node:assert/strict'
import {
  findChunksPerMb,
  estimateChunkCount,
  estimateBatch,
  BYTES_PER_CHUNK_ON_DISK,
} from '../../app/utils/kb_ratio_lookup.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const rows = [
  { pattern: '', chunks_per_mb: 5 }, // catch-all
  { pattern: 'wikipedia_en_', chunks_per_mb: 10 },
  { pattern: 'wikipedia_en_simple_', chunks_per_mb: 20 },
  { pattern: 'devdocs_', chunks_per_mb: 8 },
]

check('longest matching prefix wins', () => {
  assert.equal(findChunksPerMb('wikipedia_en_simple_all_2026-01.zim', rows), 20)
  assert.equal(findChunksPerMb('wikipedia_en_all_2026-01.zim', rows), 10)
})
check('falls back to the catch-all when only it matches', () => {
  assert.equal(findChunksPerMb('random_file.zim', rows), 5)
})
check('ignoreCatchAll excludes the empty pattern → null for fallback-only', () => {
  assert.equal(findChunksPerMb('random_file.zim', rows, { ignoreCatchAll: true }), null)
  assert.equal(findChunksPerMb('devdocs_bash.zim', rows, { ignoreCatchAll: true }), 8)
})
check('no match + no catch-all → null', () => {
  assert.equal(findChunksPerMb('x', [{ pattern: 'devdocs_', chunks_per_mb: 8 }]), null)
})

check('estimateChunkCount = round(ratio × MB)', () => {
  // 10 MB × 10 chunks/MB = 100
  assert.equal(estimateChunkCount('wikipedia_en_all', 10 * 1024 * 1024, rows), 100)
})
check('estimateChunkCount returns null when unmatched (ignoreCatchAll)', () => {
  assert.equal(estimateChunkCount('mystery', 5 * 1024 * 1024, rows, { ignoreCatchAll: true }), null)
})

check('estimateBatch sums matched files, flags unknowns, computes bytes', () => {
  const r = estimateBatch(
    [
      { filename: 'devdocs_bash', sizeBytes: 1024 * 1024 }, // 8 chunks
      { filename: 'wikipedia_en_all', sizeBytes: 2 * 1024 * 1024 }, // 20 chunks
    ],
    rows.filter((x) => x.pattern !== '') // no catch-all
  )
  assert.equal(r.totalChunks, 28)
  assert.equal(r.totalBytes, 28 * BYTES_PER_CHUNK_ON_DISK)
  assert.equal(r.hasUnknown, false)
})
check('estimateBatch flags hasUnknown when a file matches nothing', () => {
  const r = estimateBatch(
    [{ filename: 'mystery', sizeBytes: 1024 * 1024 }],
    rows.filter((x) => x.pattern !== '')
  )
  assert.equal(r.hasUnknown, true)
  assert.equal(r.totalChunks, 0)
})

console.log(`\n${passed} passed`)
