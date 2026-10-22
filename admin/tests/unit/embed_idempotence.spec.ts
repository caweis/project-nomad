import { test } from '@japa/runner'
import { RagService } from '../../app/services/rag_service.js'
import { EmbedFileJob } from '../../app/jobs/embed_file_job.js'
import { QueueService } from '../../app/services/queue_service.js'
import { STABLE_VECTOR_ID_SCHEME } from '../../util/embed_jobs.js'

test.group('embedding retry idempotence', () => {
  test('repeated dispatch for one batch enqueues the same continuation job', async ({ assert }) => {
    const original = QueueService.getInstance
    const added: Array<{ data: any; options: any }> = []
    ;(QueueService as any).getInstance = () => ({
      getQueue: () => ({
        getJob: async () => undefined,
        add: async (_name: string, data: any, options: any) => {
          added.push({ data, options })
          return { id: options.jobId }
        },
      }),
    })
    try {
      const first = await EmbedFileJob.dispatch({
        filePath: '/library/book.zim',
        fileName: 'book.zim',
      })
      const runId = added[0].data.runId
      assert.isString(runId)
      assert.equal(added[0].options.attempts, 1)
      assert.notProperty(added[0].options, 'backoff')
      await EmbedFileJob.dispatch({
        filePath: '/library/book.zim',
        fileName: 'book.zim',
        batchOffset: 50,
        runId,
      })
      await EmbedFileJob.dispatch({
        filePath: '/library/book.zim',
        fileName: 'book.zim',
        batchOffset: 50,
        runId,
      })
      assert.notEqual(first.jobId, added[1].options.jobId)
      assert.equal(added[1].options.jobId, added[2].options.jobId)
      assert.equal(added[1].data.runId, added[2].data.runId)
      assert.equal(added[1].options.attempts, 1)
    } finally {
      ;(QueueService as any).getInstance = original
    }
  })

  test('upserts the same point IDs on a retry, while section scopes stay distinct', async ({
    assert,
  }) => {
    const written: Array<Array<{ id: string; payload: Record<string, unknown> }>> = []
    const ollama = {
      getClient: async () => ({
        embed: async ({ input }: { input: string[] }) => ({ embeddings: input.map(() => [1, 0]) }),
      }),
    }
    const service = new RagService({} as any, ollama as any)
    ;(service as any).embeddingModelVerified = true
    ;(service as any)._ensureCollection = async () => undefined
    ;(service as any).sourceActive = async () => true
    ;(service as any).qdrant = {
      upsert: async (
        _collection: string,
        { points }: { points: Array<{ id: string; payload: Record<string, unknown> }> }
      ) => {
        written.push(points)
      },
    }

    const metadata = { source: '/library/book.zim', article_path: 'A/Article' }
    assert.isNotNull(
      await service.embedAndStoreText('A short first section.', metadata, undefined, 'zim:50:3')
    )
    assert.isNotNull(
      await service.embedAndStoreText('A short first section.', metadata, undefined, 'zim:50:3')
    )
    assert.isNotNull(
      await service.embedAndStoreText('A different section.', metadata, undefined, 'zim:50:4')
    )

    assert.equal(written.length, 3)
    assert.deepEqual(
      written[0].map((point) => point.id),
      written[1].map((point) => point.id)
    )
    assert.notEqual(written[0][0].id, written[2][0].id)
    assert.equal(written[0][0].payload.point_id_scheme, STABLE_VECTOR_ID_SCHEME)
  })

  test('legacy cleanup selects only the source points without stable IDs', async ({ assert }) => {
    let deleted: any
    const service = new RagService({} as any, {} as any)
    ;(service as any)._ensureCollection = async () => undefined
    ;(service as any).qdrant = {
      delete: async (_collection: string, request: any) => {
        deleted = request
      },
    }
    await service.purgeLegacyPointIds('/library/book.zim')
    assert.deepEqual(deleted.filter, {
      must: [{ key: 'source', match: { value: '/library/book.zim' } }],
      must_not: [{ key: 'point_id_scheme', match: { value: STABLE_VECTOR_ID_SCHEME } }],
    })
  })
})
