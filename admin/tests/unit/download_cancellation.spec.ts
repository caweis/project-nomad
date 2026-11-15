import { test } from '@japa/runner'
import { DownloadService } from '#services/download_service'
import DownloadsController from '#controllers/downloads_controller'
import queueConfig from '#config/queue'
import { RunDownloadJob } from '#jobs/run_download_job'
import { UnrecoverableError } from 'bullmq'
import axios from 'axios'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('cancel API writes a separate request and does not remove an active job', async ({
  assert,
}) => {
  const set = queueConfig.connection.set
  const writes: unknown[][] = []
  let removed = false
  ;(queueConfig.connection as any).set = async (...args: unknown[]) => {
    writes.push(args)
    return 'OK'
  }
  try {
    const job = {
      data: {},
      getState: async () => 'active',
      remove: async () => {
        removed = true
      },
    }
    const service = new DownloadService({ getQueue: () => ({ getJob: async () => job }) } as any)
    const controller = new DownloadsController(service)
    let status = 0
    let result: any
    await controller.cancelJob({
      params: { jobId: 'fixture' },
      response: {
        status: (code: number) => {
          status = code
          return {
            send: (data: unknown) => {
              result = data
            },
          }
        },
      },
    } as any)
    assert.equal(status, 200)
    assert.isTrue(result.success)
    assert.deepEqual(writes, [[RunDownloadJob.cancellationKey('fixture'), '1', 'EX', 86400]])
    const removal = await service.removeJob('fixture')
    assert.isFalse(removal.success)
    assert.isFalse(removed)
    const invalid = await service.cancelJob('../bad')
    assert.isFalse(invalid.success)
  } finally {
    queueConfig.connection.set = set
  }
})

test('cancelled job fails once and leaves the installed file intact', async ({ assert }) => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-cancel-job-'))
  const filepath = join(directory, 'file.bin')
  await writeFile(filepath, 'keep')
  await writeFile(filepath + '.tmp', 'partial')
  const get = queueConfig.connection.get
  const del = queueConfig.connection.del
  const head = axios.head
  let requests = 0
  ;(queueConfig.connection as any).get = async () => '1'
  ;(queueConfig.connection as any).del = async () => 1
  ;(axios as any).head = async () => {
    requests++
    throw new Error('must not download')
  }
  try {
    await assert.rejects(
      () =>
        new RunDownloadJob().handle({
          id: 'fixture',
          data: {
            url: 'https://example.com/test',
            filepath,
            filetype: 'document',
            timeout: 1000,
            allowedMimeTypes: [],
          },
          attemptsMade: 0,
        } as any),
      UnrecoverableError,
      'Download cancelled: by user'
    )
    assert.equal(requests, 0)
    assert.equal(await readFile(filepath, 'utf8'), 'keep')
  } finally {
    queueConfig.connection.get = get
    queueConfig.connection.del = del
    axios.head = head
    await rm(directory, { recursive: true, force: true })
  }
})

test('a late cancellation poll cannot turn a completion failure into terminal cancellation', async ({
  assert,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-cancel-finalizing-'))
  const filepath = join(directory, 'file.bin')
  const get = queueConfig.connection.get
  const del = queueConfig.connection.del
  const head = axios.head
  const fetch = axios.get
  const interval = globalThis.setInterval
  const clear = globalThis.clearInterval
  let poll!: () => void
  let finishPoll!: (value: string) => void
  let polling!: Promise<unknown>
  let calls = 0
  ;(queueConfig.connection as any).get = () =>
    ++calls === 1
      ? Promise.resolve(null)
      : new Promise((resolve) => {
          finishPoll = resolve
        })
  ;(queueConfig.connection as any).del = async () => 1
  ;(globalThis as any).setInterval = (callback: () => void) => {
    poll = callback
    return { unref() {} }
  }
  ;(globalThis as any).clearInterval = () => {}
  ;(axios as any).head = async () => ({ headers: { 'content-length': '4' } })
  ;(axios as any).get = async () => {
    poll()
    polling = Promise.resolve()
    const { Readable } = await import('node:stream')
    return { status: 200, headers: {}, data: Readable.from(['good']) }
  }
  try {
    await assert.rejects(
      () =>
        new RunDownloadJob().handle({
          id: 'fixture',
          attemptsMade: 0,
          data: {
            url: 'https://example.com/test',
            filepath,
            filetype: 'document',
            timeout: 1000,
            allowedMimeTypes: [],
          },
          updateProgress: async () => {},
          updateData: async () => {
            finishPoll('1')
            await polling
            await new Promise((resolve) => setImmediate(resolve))
            throw new Error('queue update failed')
          },
        } as any),
      Error,
      'queue update failed'
    )
    assert.equal(await readFile(filepath, 'utf8'), 'good')
  } finally {
    queueConfig.connection.get = get
    queueConfig.connection.del = del
    axios.head = head
    axios.get = fetch
    globalThis.setInterval = interval
    globalThis.clearInterval = clear
    await rm(directory, { recursive: true, force: true })
  }
})
