import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Queue, QueueEvents } from 'bullmq'
import { Redis } from 'ioredis'

assert.equal(
  process.env.NOMAD_DISPOSABLE_REDIS,
  '1',
  'Use a disposable Redis instance, never the installed stack'
)
assert.ok(process.env.REDIS_PORT, 'Explicit test Redis port required')
const adminRoot = fileURLToPath(new URL('../../', import.meta.url))
const runId = Date.now().toString(36)
const directory = await mkdtemp(join(tmpdir(), 'nomad-worker-smoke-'))
const connection = { host: '127.0.0.1', port: Number(process.env.REDIS_PORT) }
const redis = new Redis({ ...connection, maxRetriesPerRequest: null })
const queue = new Queue('downloads', { connection })
const events = new QueueEvents('downloads', { connection })
let worker
let output = ''
let slowStarted
const slowReady = new Promise((resolve) => {
  slowStarted = resolve
})
const server = createServer((req, res) => {
  const slow = req.url === '/slow'
  res.setHeader('Content-Length', slow ? '1000000' : '7')
  if (req.method === 'HEAD') return res.end()
  if (!slow) return res.end('fixture')
  res.write(Buffer.alloc(1024))
  slowStarted()
  const timer = setInterval(() => res.write(Buffer.alloc(1024)), 50)
  res.on('close', () => clearInterval(timer))
})
const deadline = async (fn, label, timeout = 15000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 30))
  }
  throw new Error(`${label} timed out\n${output}`)
}
try {
  await server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  await events.waitUntilReady()
  const port = server.address().port
  worker = spawn(
    process.execPath,
    [
      '--import',
      join(adminRoot, 'tests/fixtures/worker_http.mjs'),
      'ace.js',
      'queue:work',
      '--queue=downloads',
    ],
    {
      cwd: join(adminRoot, 'build'),
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  worker.stdout.on('data', (data) => {
    output += data
  })
  worker.stderr.on('data', (data) => {
    output += data
  })
  await deadline(() => output.includes('Worker started for queue: downloads'), 'queue startup')
  const data = {
    url: `http://fixture.nomad.test:${port}/ok`,
    filepath: join(directory, 'success.bin'),
    timeout: 5000,
    allowedMimeTypes: [],
    filetype: 'document',
  }
  const job = await queue.add('run-download', data, {
    jobId: `smoke-complete-${runId}`,
    attempts: 3,
  })
  await job.waitUntilFinished(events, 15000)
  assert.equal(await readFile(data.filepath, 'utf8'), 'fixture')
  console.log('PASS real worker downloads and publishes exact bytes')

  const cancelledPath = join(directory, 'cancel.bin')
  await writeFile(cancelledPath, 'installed')
  const cancelled = await queue.add(
    'run-download',
    {
      ...data,
      url: `http://fixture.nomad.test:${port}/slow`,
      filepath: cancelledPath,
      forceNew: true,
    },
    { jobId: `smoke-cancel-${runId}`, attempts: 3 }
  )
  await Promise.race([
    slowReady,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('stream never started')), 10000).unref()
    ),
  ])
  await redis.set(`nomad:download-cancel:smoke-cancel-${runId}`, '1', 'EX', 60)
  await assert.rejects(cancelled.waitUntilFinished(events, 15000), /Download cancelled/)
  const failed = await queue.getJob(cancelled.id)
  assert.equal(failed.attemptsMade, 1, 'user cancellation must not retry')
  assert.ok(failed.finishedOn, 'cancelled job must be terminal on the first attempt')
  assert.equal(await readFile(cancelledPath, 'utf8'), 'installed')
  await assert.rejects(stat(cancelledPath + '.tmp'), { code: 'ENOENT' })
  console.log('PASS cancellation stops the stream, skips retries, preserves installed content')

  await redis.set(`nomad:download-cancel:smoke-pre-cancel-${runId}`, '1', 'EX', 60)
  const before = await queue.add('run-download', data, {
    jobId: `smoke-pre-cancel-${runId}`,
    attempts: 3,
  })
  await assert.rejects(before.waitUntilFinished(events, 15000), /Download cancelled/)
  console.log('PASS cancellation requested before worker pickup is honored')
  worker.kill('SIGTERM')
  await deadline(() => worker.exitCode !== null, 'graceful worker shutdown')
  assert.equal(worker.exitCode, 0, output)
  console.log('4 passed: real worker startup, download, cancellation and shutdown')
} finally {
  if (worker && worker.exitCode === null) worker.kill('SIGKILL')
  await events.close()
  await queue.close()
  redis.disconnect()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
