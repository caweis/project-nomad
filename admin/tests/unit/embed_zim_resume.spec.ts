import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Archive } from '@openzim/libzim'
import { test } from '@japa/runner'
import { UnrecoverableError, type Job } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import { EmbedFileJob, type EmbedFileJobParams } from '#jobs/embed_file_job'
import { RagService } from '#services/rag_service'
import { DockerService } from '#services/docker_service'
import { OllamaService } from '#services/ollama_service'
import { QueueService } from '#services/queue_service'
import { ZIMExtractionService } from '#services/zim_extraction_service'
import KbIngestState from '#models/kb_ingest_state'
import { continuationJobId, safeEmbedFailureReason } from '../../util/embed_jobs.js'

const ZIM = fileURLToPath(
  new URL('../../../install/wikipedia_en_100_mini_2025-06.zim', import.meta.url)
)

function jobFor(data: EmbedFileJobParams) {
  const job = {
    id: 'existing-run-job',
    data,
    async updateProgress(_progress: number) {},
    async updateData(next: EmbedFileJobParams) {
      job.data = next
    },
  }
  return job as unknown as Job
}

async function withIsolatedDependencies(
  run: (state: {
    purges: string[]
    embedded: Array<{ articlePath?: string; documentId?: string; scope?: string }>
    queued: Array<{
      data: EmbedFileJobParams
      options: { attempts: number; jobId: string; backoff?: unknown }
    }>
    indexed: Array<{ path: string; chunks: number; collection?: string }>
    failed: Array<{ path: string; reason: string }>
  }) => Promise<void>
) {
  const original = {
    models: OllamaService.prototype.getModels,
    url: DockerService.prototype.getServiceURL,
    purge: RagService.prototype.purgeLegacyPointIds,
    embed: RagService.prototype.embedAndStoreText,
    process: RagService.prototype.processAndEmbedFile,
    queue: QueueService.getInstance,
    find: KbIngestState.findBy,
    indexed: KbIngestState.markIndexed,
    failed: KbIngestState.markFailed,
  }
  const state: Parameters<typeof run>[0] = {
    purges: [],
    embedded: [],
    queued: [],
    indexed: [],
    failed: [],
  }
  try {
    OllamaService.prototype.getModels = async () => []
    DockerService.prototype.getServiceURL = async () => 'http://qdrant.test:6333'
    RagService.prototype.purgeLegacyPointIds = async (path) => {
      state.purges.push(path)
    }
    RagService.prototype.embedAndStoreText = async (_text, metadata = {}, _progress, scope) => {
      state.embedded.push({
        articlePath: metadata.article_path,
        documentId: metadata.document_id,
        scope,
      })
      return { chunks: 1 }
    }
    QueueService.getInstance = (() => ({
      getQueue: () => ({
        getJob: async () => undefined,
        add: async (
          _name: string,
          data: EmbedFileJobParams,
          options: (typeof state.queued)[number]['options']
        ) => {
          state.queued.push({ data, options })
          return { id: options.jobId }
        },
      }),
    })) as unknown as typeof QueueService.getInstance
    KbIngestState.findBy = async () => ({ collection: 'saved-collection' }) as KbIngestState
    KbIngestState.markIndexed = async (path, chunks, collection) => {
      state.indexed.push({ path, chunks, collection })
    }
    KbIngestState.markFailed = async (path, reason) => {
      state.failed.push({ path, reason })
    }
    await run(state)
  } finally {
    OllamaService.prototype.getModels = original.models
    DockerService.prototype.getServiceURL = original.url
    RagService.prototype.purgeLegacyPointIds = original.purge
    RagService.prototype.embedAndStoreText = original.embed
    RagService.prototype.processAndEmbedFile = original.process
    QueueService.getInstance = original.queue
    KbIngestState.findBy = original.find
    KbIngestState.markIndexed = original.indexed
    KbIngestState.markFailed = original.failed
  }
}

test.group('ZIM continuation jobs', (group) => {
  group.setup(() => {
    const level = logger.level
    logger.level = 'silent'
    return () => {
      logger.level = level
    }
  })

  for (const cursor of [undefined, 1200]) {
    test(`threads ${cursor === undefined ? 'legacy' : 'saved'} cursor through the run without purging prior vectors`, async () => {
      await withIsolatedDependencies(async (state) => {
        let receivedCursor: number | undefined
        RagService.prototype.processAndEmbedFile = async (
          _path,
          _delete,
          offset,
          _progress,
          collection,
          resumeAtDirent
        ) => {
          assert.equal(offset, 50)
          assert.equal(collection, 'saved-collection')
          receivedCursor = resumeAtDirent
          return {
            success: true,
            message: 'Batch complete',
            chunks: 7,
            articlesProcessed: 50,
            hasMoreBatches: true,
            resumeAtDirent: 2345,
          }
        }
        const job = jobFor({
          filePath: ZIM,
          fileName: 'library.zim',
          batchOffset: 50,
          chunksSoFar: 11,
          runId: 'existing-run',
          ...(cursor !== undefined ? { resumeAtDirent: cursor } : {}),
        })
        await new EmbedFileJob().handle(job)
        assert.equal(receivedCursor, cursor)
        assert.equal(state.queued.length, 1)
        assert.equal(state.queued[0].data.resumeAtDirent, 2345)
        assert.equal(state.queued[0].data.batchOffset, 100)
        assert.equal(state.queued[0].data.chunksSoFar, 18)
        assert.equal(state.queued[0].data.collection, 'saved-collection')
        assert.equal(state.queued[0].data.runId, 'existing-run')
        assert.equal(state.queued[0].options.jobId, continuationJobId('existing-run', 100))
        assert.equal(state.queued[0].options.attempts, 1)
        assert.equal(state.queued[0].options.backoff, undefined)
        assert.equal(job.data.status, 'batch_completed')
        assert.deepEqual(state.purges, [])
        assert.deepEqual(state.indexed, [])
        assert.deepEqual(state.failed, [])
      })
    })
  }

  test('the real extraction and RAG pipeline carries cursors through the full job chain', async () => {
    await withIsolatedDependencies(async (state) => {
      const whole = await new ZIMExtractionService().extractZIMContent(ZIM)
      const first = jobFor({ filePath: ZIM, fileName: 'library.zim', runId: 'existing-run' })
      await new EmbedFileJob().handle(first)
      let last = first
      let dispatched = 0
      while (dispatched < state.queued.length) {
        assert.ok(dispatched < 10, 'continuation chain must terminate')
        const next = state.queued[dispatched++].data
        assert.ok(next.resumeAtDirent, 'RAG must return the cursor that the job dispatches')
        last = jobFor(next)
        await new EmbedFileJob().handle(last)
      }

      assert.equal(state.queued.length, 2)
      assert.deepEqual(
        state.queued.map(({ data }) => data.batchOffset),
        [50, 100]
      )
      assert.deepEqual(
        state.embedded.map(({ articlePath, documentId }) => ({ articlePath, documentId })),
        whole.chunks.map(({ articlePath, documentId }) => ({ articlePath, documentId }))
      )
      assert.equal(new Set(state.embedded.map(({ scope }) => scope)).size, whole.chunks.length)
      assert.equal(last.data.status, 'completed')
      assert.deepEqual(state.indexed, [
        { path: ZIM, chunks: whole.chunks.length, collection: 'saved-collection' },
      ])
      assert.deepEqual(state.purges, [ZIM])
      assert.deepEqual(state.failed, [])
    })
  }).timeout(60000)

  test('legacy and seek continuations retain identical vector scopes and document IDs', async () => {
    await withIsolatedDependencies(async (state) => {
      const service = new RagService({} as DockerService, {} as OllamaService)
      const first = await service.processAndEmbedFile(ZIM, false)
      assert.ok(first.resumeAtDirent)
      state.embedded.length = 0
      const seek = await service.processAndEmbedFile(
        ZIM,
        false,
        50,
        undefined,
        undefined,
        first.resumeAtDirent
      )
      const seekPoints = [...state.embedded]
      state.embedded.length = 0
      const legacy = await service.processAndEmbedFile(ZIM, false, 50)
      assert.deepEqual(legacy, seek)
      assert.deepEqual(state.embedded, seekPoints)
    })
  }).timeout(60000)

  test('an empty valid EOF below articleCount marks the existing run indexed', async () => {
    await withIsolatedDependencies(async (state) => {
      const archive = new Archive(ZIM)
      const job = jobFor({
        filePath: ZIM,
        fileName: 'library.zim',
        batchOffset: 101,
        totalArticles: archive.articleCount,
        resumeAtDirent: archive.iterByPath().size,
        chunksSoFar: 312,
        runId: 'existing-run',
      })
      const result = await new EmbedFileJob().handle(job)
      assert.equal(result.success, true)
      assert.equal(job.data.status, 'completed')
      assert.equal(job.data.chunks, 312)
      assert.deepEqual(state.indexed, [{ path: ZIM, chunks: 312, collection: 'saved-collection' }])
      assert.deepEqual(state.queued, [])
      assert.deepEqual(state.embedded, [])
      assert.deepEqual(state.purges, [])
      assert.deepEqual(state.failed, [])
    })
  }).timeout(60000)

  test('a past-end cursor reaches a terminal failed job and never marks the file indexed', async () => {
    await withIsolatedDependencies(async (state) => {
      const job = jobFor({
        filePath: ZIM,
        fileName: 'library.zim',
        batchOffset: 50,
        resumeAtDirent: new Archive(ZIM).iterByPath().size + 1,
        chunksSoFar: 312,
        runId: 'existing-run',
      })
      await assert.rejects(new EmbedFileJob().handle(job), UnrecoverableError)
      const reason = safeEmbedFailureReason(new Error('Invalid cursor'))
      assert.equal(job.data.status, 'failed')
      assert.equal(job.data.error, reason)
      assert.equal(job.data.chunksSoFar, 312)
      assert.deepEqual(state.failed, [{ path: ZIM, reason }])
      assert.deepEqual(state.indexed, [])
      assert.deepEqual(state.queued, [])
      assert.deepEqual(state.embedded, [])
      assert.deepEqual(state.purges, [])
    })
  }).timeout(60000)
})
