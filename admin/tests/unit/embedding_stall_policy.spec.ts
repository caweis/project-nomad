import { EventEmitter } from 'node:events'
import { test } from '@japa/runner'
import QueueWork from '../../commands/queue/work.js'
import { EmbedFileJob } from '#jobs/embed_file_job'
import { DownloadDrugDataJob } from '#jobs/download_drug_data_job'
import { IngestDrugDataJob } from '#jobs/ingest_drug_data_job'
import KbIngestState from '#models/kb_ingest_state'
import { safeEmbedFailureReason } from '../../util/embed_jobs.js'

type JobData = Record<string, unknown>

function embeddingJob() {
  return {
    id: 'embedding-job',
    name: EmbedFileJob.key,
    finishedOn: 1_700_000_000_000,
    data: {
      filePath: '/test/library.zim',
      status: 'processing',
      runId: 'indexing-run',
      chunksSoFar: 50,
    } as JobData,
    writes: [] as JobData[],
    async updateData(data: JobData) {
      this.writes.push(data)
      this.data = data
    },
  }
}

async function withFailureListener(
  run: (context: {
    fail: (job: unknown, error: Error) => Promise<void>
    savedFailures: Array<{ filePath: string; reason: string }>
    errors: string[]
  }) => Promise<void>,
  options: { queueName?: string; databaseError?: Error } = {}
) {
  const command = Object.create(QueueWork.prototype) as any
  const errors: string[] = []
  Object.defineProperty(command, 'logger', {
    value: { error: (message: string) => errors.push(message) },
  })
  const worker = new EventEmitter()
  command.registerFailureHandler(worker, options.queueName ?? EmbedFileJob.queue)

  const savedFailures: Array<{ filePath: string; reason: string }> = []
  const originalMarkFailed = KbIngestState.markFailed
  KbIngestState.markFailed = async (filePath, reason) => {
    if (options.databaseError) throw options.databaseError
    savedFailures.push({ filePath, reason })
  }

  try {
    await run({
      async fail(job, error) {
        // Exercise the registered Worker failure listener, including its queue guards.
        for (const listener of worker.listeners('failed')) await listener(job, error)
      },
      savedFailures,
      errors,
    })
  } finally {
    KbIngestState.markFailed = originalMarkFailed
  }
}

test('embedding workers do not automatically replay a stalled batch', ({ assert }) => {
  const command = Object.create(QueueWork.prototype) as any
  assert.deepEqual(command.getStallOptionsForQueue(EmbedFileJob.queue), {
    lockDuration: 1_800_000,
    maxStalledCount: 0,
  })
  for (const queue of [DownloadDrugDataJob.queue, IngestDrugDataJob.queue]) {
    assert.deepEqual(command.getStallOptionsForQueue(queue), {
      lockDuration: 1_800_000,
      maxStalledCount: 3,
    })
  }
  assert.deepEqual(command.getStallOptionsForQueue('downloads'), {
    lockDuration: 600_000,
    maxStalledCount: 1,
  })
})

test('a terminal worker stall marks both embedding job data and the file as failed', async ({
  assert,
}) => {
  await withFailureListener(async ({ fail, savedFailures }) => {
    const job = embeddingJob()
    const error = new Error('job stalled more than allowable limit')
    const reason = safeEmbedFailureReason(error)
    await fail(job, error)

    assert.deepEqual(job.writes, [
      {
        filePath: '/test/library.zim',
        status: 'failed',
        runId: 'indexing-run',
        chunksSoFar: 50,
        failedAt: job.finishedOn,
        error: reason,
      },
    ])
    assert.deepEqual(savedFailures, [{ filePath: '/test/library.zim', reason }])
  })
})

test('worker failure records and logs only a safe embedding failure reason', async ({ assert }) => {
  await withFailureListener(async ({ fail, savedFailures, errors }) => {
    const job = embeddingJob()
    const error = new Error('Failed to open /private/client.pdf?token=secret')
    await fail(job, error)

    assert.equal(job.data.error, safeEmbedFailureReason(error))
    assert.equal(savedFailures[0]?.reason, safeEmbedFailureReason(error))
    assert.isFalse(
      errors.some((message) => message.includes('/private') || message.includes('secret'))
    )
  })
})

test('worker failure keeps a known safe embedding failure message', async ({ assert }) => {
  await withFailureListener(async ({ fail, savedFailures }) => {
    const job = embeddingJob()
    await fail(job, new Error('Qdrant service not ready yet'))
    assert.equal(job.data.error, 'Qdrant service not ready yet')
    assert.equal(savedFailures[0]?.reason, 'Qdrant service not ready yet')
  })
})

test('worker failure ignores missing jobs, missing files, other jobs, and nonterminal attempts', async ({
  assert,
}) => {
  await withFailureListener(async ({ fail, savedFailures }) => {
    const candidates = [
      undefined,
      { ...embeddingJob(), data: undefined },
      { ...embeddingJob(), data: {} },
      { ...embeddingJob(), data: { filePath: '' } },
      { ...embeddingJob(), data: { filePath: '   ' } },
      { ...embeddingJob(), data: { filePath: 123 } },
      { ...embeddingJob(), name: 'other-job' },
      { ...embeddingJob(), finishedOn: undefined },
      { ...embeddingJob(), finishedOn: 0 },
    ]
    for (const candidate of candidates) {
      await fail(candidate, new Error('job stalled more than allowable limit'))
      if (candidate) assert.deepEqual(candidate.writes, [])
    }
    assert.deepEqual(savedFailures, [])
  })
})

test('an unrelated queue cannot mark an embedding file as failed', async ({ assert }) => {
  await withFailureListener(
    async ({ fail, savedFailures }) => {
      const job = embeddingJob()
      await fail(job, new Error('job stalled more than allowable limit'))
      assert.deepEqual(job.writes, [])
      assert.deepEqual(savedFailures, [])
    },
    { queueName: 'downloads' }
  )
})

test('a failed Redis update cannot prevent persisting the file failure', async ({ assert }) => {
  await withFailureListener(async ({ fail, savedFailures, errors }) => {
    const job = embeddingJob()
    job.updateData = async () => {
      throw new Error('Redis failed: /private/redis-secret')
    }
    await fail(job, new Error('job stalled more than allowable limit'))

    assert.lengthOf(savedFailures, 1)
    assert.isTrue(
      errors.some((message) => message.includes('Failed to update embedding job failure state'))
    )
    assert.isFalse(errors.some((message) => message.includes('redis-secret')))
  })
})

test('a failed database write cannot prevent persisting the job failure or reject the listener', async ({
  assert,
}) => {
  await withFailureListener(
    async ({ fail, savedFailures, errors }) => {
      const job = embeddingJob()
      await fail(job, new Error('job stalled more than allowable limit'))

      assert.equal(job.data.status, 'failed')
      assert.deepEqual(savedFailures, [])
      assert.isTrue(
        errors.some((message) => message.includes('Failed to persist embedding file failure state'))
      )
      assert.isFalse(errors.some((message) => message.includes('database-secret')))
    },
    { databaseError: new Error('Database failed: /private/database-secret') }
  )
})
