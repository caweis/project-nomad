import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Archive } from '@openzim/libzim'
import { test } from '@japa/runner'
import { UnrecoverableError } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import { ZIMExtractionService } from '../../app/services/zim_extraction_service.js'

// Exercise the real native iterator and production extraction loop (#1185).
const ZIM = fileURLToPath(
  new URL('../../../install/wikipedia_en_100_mini_2025-06.zim', import.meta.url)
)
const BATCH = 7

function articlePaths(chunks: { articlePath: string }[]) {
  return [...new Set(chunks.map((chunk) => chunk.articlePath))]
}

test.group('ZIM extraction seek batches', (group) => {
  group.setup(() => {
    const level = logger.level
    logger.level = 'silent'
    return () => {
      logger.level = level
    }
  })

  test('chained batches cover each article exactly once with stable document IDs', async () => {
    const service = new ZIMExtractionService()
    const whole = await service.extractZIMContent(ZIM)
    const chunks = [] as typeof whole.chunks
    let startOffset = 0
    let resumeAtDirent: number | undefined

    for (;;) {
      const batch = await service.extractZIMContent(ZIM, {
        startOffset,
        batchSize: BATCH,
        resumeAtDirent,
      })
      assert.ok(Number.isInteger(batch.resumeAtDirent), 'extraction must return a directory cursor')
      assert.ok(batch.resumeAtDirent! > (resumeAtDirent ?? 0), 'each nonempty batch must advance')
      chunks.push(...batch.chunks)
      startOffset += batch.articlesProcessed
      if (batch.articlesProcessed < BATCH) break
      resumeAtDirent = batch.resumeAtDirent
    }

    assert.ok(startOffset > BATCH, 'expected several batches')
    assert.equal(startOffset, whole.articlesProcessed)
    assert.deepEqual(articlePaths(chunks), articlePaths(whole.chunks))
    assert.deepEqual(chunks, whole.chunks)
  }).timeout(60000)

  test('a legacy continuation reaches the same next cursor and content as a seek', async () => {
    const service = new ZIMExtractionService()
    const first = await service.extractZIMContent(ZIM, { batchSize: BATCH })
    assert.ok(first.resumeAtDirent)
    const seek = await service.extractZIMContent(ZIM, {
      startOffset: BATCH,
      batchSize: BATCH,
      resumeAtDirent: first.resumeAtDirent,
    })
    const legacy = await service.extractZIMContent(ZIM, { startOffset: BATCH, batchSize: BATCH })

    assert.deepEqual(legacy.chunks, seek.chunks)
    assert.equal(legacy.articlesProcessed, seek.articlesProcessed)
    assert.equal(legacy.resumeAtDirent, seek.resumeAtDirent)
    assert.ok(legacy.resumeAtDirent! > first.resumeAtDirent!)
  }).timeout(60000)

  test('an exact final batch ends with an empty successful seek below the archive article count', async () => {
    const archive = new Archive(ZIM)
    const service = new ZIMExtractionService()
    const whole = await service.extractZIMContent(ZIM)
    assert.ok(
      whole.articlesProcessed < archive.articleCount,
      'fixture must contain counted redirects'
    )
    const exact = await service.extractZIMContent(ZIM, { batchSize: whole.articlesProcessed })
    assert.ok(exact.resumeAtDirent)
    assert.equal(exact.articlesProcessed, whole.articlesProcessed)
    const end = await service.extractZIMContent(ZIM, {
      startOffset: exact.articlesProcessed,
      batchSize: exact.articlesProcessed,
      resumeAtDirent: exact.resumeAtDirent,
    })

    assert.equal(end.articlesProcessed, 0)
    assert.deepEqual(end.chunks, [])
    assert.equal(end.resumeAtDirent, archive.iterByPath().size)
  }).timeout(60000)

  test('a cursor beyond the real archive range fails unrecoverably', async () => {
    const rangeSize = new Archive(ZIM).iterByPath().size
    await assert.rejects(
      new ZIMExtractionService().extractZIMContent(ZIM, {
        startOffset: BATCH,
        batchSize: BATCH,
        resumeAtDirent: rangeSize + 1,
      }),
      UnrecoverableError
    )
  }).timeout(60000)
})
