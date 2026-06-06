import { test } from '@japa/runner'
import { mapEmbedJob } from '../../util/embed_jobs.js'

test.group('mapEmbedJob', () => {
  test('maps an in-flight job, preserving its data status', ({ assert }) => {
    const dto = mapEmbedJob({
      id: 'abc123',
      data: { fileName: 'guide.pdf', filePath: '/kb/guide.pdf', status: 'processing' },
      progress: 42,
    })
    assert.deepEqual(dto, {
      jobId: 'abc123',
      fileName: 'guide.pdf',
      filePath: '/kb/guide.pdf',
      progress: 42,
      status: 'processing',
    })
    assert.notProperty(dto, 'failedReason')
  })

  test('defaults status to waiting when data has none', ({ assert }) => {
    const dto = mapEmbedJob({ id: 1, data: { fileName: 'a', filePath: '/a' }, progress: 0 })
    assert.equal(dto.status, 'waiting')
  })

  test('surfaces failedReason and forces failed status when a job failed', ({ assert }) => {
    // The whole point of the fix: a failed embed must be visible WITH its reason.
    const dto = mapEmbedJob({
      id: 'x',
      data: { fileName: 'big.zim', filePath: '/zim/big.zim', status: 'processing' },
      progress: 12,
      failedReason: 'Qdrant service not ready yet',
    })
    assert.equal(dto.status, 'failed')
    assert.equal(dto.failedReason, 'Qdrant service not ready yet')
  })

  test('failed status wins even if data.status says completed', ({ assert }) => {
    const dto = mapEmbedJob({
      id: 'y',
      data: { fileName: 'f', filePath: '/f', status: 'completed' },
      progress: 100,
      failedReason: 'boom',
    })
    assert.equal(dto.status, 'failed')
  })

  test('coerces a numeric job id to string', ({ assert }) => {
    const dto = mapEmbedJob({ id: 99, data: { fileName: 'f', filePath: '/f' }, progress: 0 })
    assert.equal(dto.jobId, '99')
    assert.isString(dto.jobId)
  })

  test('tolerates a missing id and non-numeric progress', ({ assert }) => {
    const dto = mapEmbedJob({ data: { fileName: 'f', filePath: '/f' }, progress: { pct: 50 } })
    assert.equal(dto.jobId, '')
    assert.equal(dto.progress, 0)
  })

  test('tolerates missing data entirely', ({ assert }) => {
    const dto = mapEmbedJob({ id: 'z', progress: 0 })
    assert.equal(dto.fileName, '')
    assert.equal(dto.filePath, '')
    assert.equal(dto.status, 'waiting')
  })
})
