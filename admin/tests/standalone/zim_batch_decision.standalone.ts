/**
 * Standalone checks for when a batched ZIM ingestion continues.
 *
 *   node --experimental-strip-types tests/standalone/zim_batch_decision.standalone.ts
 *
 * Ported from upstream's zim_batch_decision.spec.ts (1933f8ee), which is
 * node:test and would register nothing under this fork's Japa glob.
 *
 * The defect these pin stopped indexing partway through most medical
 * references: the loop continued only while the batch produced text, so the
 * first window of navigation pages looked like the end of the archive.
 */
import assert from 'node:assert/strict'
import { hasMoreArticleBatches } from '../../app/utils/zim_batch_decision.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const BATCH = 50

check('continues while the extractor keeps filling the batch', () => {
  assert.equal(hasMoreArticleBatches({ articlesProcessed: BATCH, batchSize: BATCH }), true)
})

check('stops once the extractor runs out of article entries', () => {
  assert.equal(hasMoreArticleBatches({ articlesProcessed: 12, batchSize: BATCH }), false)
})

check('stops on an archive smaller than one batch', () => {
  assert.equal(hasMoreArticleBatches({ articlesProcessed: 1, batchSize: BATCH }), false)
})

check('stops on an exhausted iterator that yielded nothing', () => {
  assert.equal(hasMoreArticleBatches({ articlesProcessed: 0, batchSize: BATCH }), false)
})

check('continues through a full batch that produced almost no text', () => {
  // Medicine LibreTexts (23,171 articles) embedded 16 chunks: its first 50
  // entries are navigation pages and only 10 had text. The old gate asked
  // whether 10 >= 50 and stopped; a full batch was consumed, so it must go on.
  const articlesWithContent = 10
  assert.equal(hasMoreArticleBatches({ articlesProcessed: BATCH, batchSize: BATCH }), true)
  assert.equal(articlesWithContent >= BATCH, false, 'the old gate stopped here')
})

check('walks a zero-text archive to the end instead of stopping at batch one', () => {
  // A media archive yields no text at all, but its articles still have to be
  // walked to the end rather than abandoned after the first batch.
  assert.equal(hasMoreArticleBatches({ articlesProcessed: BATCH, batchSize: BATCH }), true)
  assert.equal(hasMoreArticleBatches({ articlesProcessed: 42, batchSize: BATCH }), false)
})

console.log(`\n${passed} passed`)
