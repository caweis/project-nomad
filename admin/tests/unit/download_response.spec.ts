import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import axios from 'axios'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { doResumableDownload } from '../../app/utils/downloads.js'

test('a fresh download rejects an unsolicited partial response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-download-response-'))
  const filepath = join(directory, 'file.bin')
  const originalHead = axios.head
  const originalGet = axios.get

  try {
    ;(axios as any).head = async () => ({
      headers: {
        'content-length': '12',
        'accept-ranges': 'bytes',
        'content-type': 'application/octet-stream',
      },
    })
    ;(axios as any).get = async () => ({
      status: 206,
      data: Readable.from([Buffer.from('partial')]),
    })

    await assert.rejects(
      () =>
        doResumableDownload({
          url: 'https://example.com/file.bin',
          filepath,
          timeout: 30000,
          allowedMimeTypes: [],
        }),
      /partial response/i
    )
    await assert.rejects(() => stat(filepath), { code: 'ENOENT' })
  } finally {
    ;(axios as any).head = originalHead
    ;(axios as any).get = originalGet
    await rm(directory, { recursive: true, force: true })
  }
})

test('a short response cannot become a completed download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-download-response-'))
  const filepath = join(directory, 'file.bin')
  const originalHead = axios.head
  const originalGet = axios.get

  try {
    ;(axios as any).head = async () => ({
      headers: { 'content-length': '12', 'content-type': 'application/octet-stream' },
    })
    ;(axios as any).get = async () => ({
      status: 200,
      data: Readable.from([Buffer.from('short')]),
    })

    await assert.rejects(
      () =>
        doResumableDownload({
          url: 'https://example.com/file.bin',
          filepath,
          timeout: 30000,
          allowedMimeTypes: [],
        }),
      /incomplete download/i
    )
    await assert.rejects(() => stat(filepath), { code: 'ENOENT' })
  } finally {
    ;(axios as any).head = originalHead
    ;(axios as any).get = originalGet
    await rm(directory, { recursive: true, force: true })
  }
})

test('a complete response is published with its exact bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-download-response-'))
  const filepath = join(directory, 'file.bin')
  const originalHead = axios.head
  const originalGet = axios.get

  try {
    ;(axios as any).head = async () => ({
      headers: { 'content-length': '5', 'content-type': 'application/octet-stream' },
    })
    ;(axios as any).get = async () => ({
      status: 200,
      data: Readable.from([Buffer.from('hello')]),
    })

    const output = await doResumableDownload({
      url: 'https://example.com/file.bin',
      filepath,
      timeout: 30000,
      allowedMimeTypes: [],
    })

    assert.equal(output, filepath)
    const contents = await readFile(filepath)
    assert.equal(contents.toString(), 'hello')
    await assert.rejects(() => stat(filepath + '.tmp'), { code: 'ENOENT' })
  } finally {
    ;(axios as any).head = originalHead
    ;(axios as any).get = originalGet
    await rm(directory, { recursive: true, force: true })
  }
})

for (const contentRange of [
  'bytes 0-2/6',
  'bytes 3-5/9',
  'bytes 3-2/6',
  'bytes 3-99/6',
  'bytes 3-5/*',
  undefined,
]) {
  test(`a resume rejects mismatched range ${contentRange} and starts fresh`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nomad-range-'))
    const filepath = join(directory, 'file.bin')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filepath + '.tmp', 'abc')
    await writeFile(
      filepath + '.tmp.source',
      createHash('sha256').update('https://example.com/file.bin').digest('hex')
    )
    const head = axios.head
    const get = axios.get
    const requests: unknown[] = []
    try {
      ;(axios as any).head = async () => ({
        headers: { 'content-length': '6', 'accept-ranges': 'bytes' },
      })
      ;(axios as any).get = async (_url: string, config: any) => {
        requests.push(config.headers.Range)
        return config.headers.Range
          ? {
              status: 206,
              headers: { 'content-range': contentRange },
              data: Readable.from(['XYZ']),
            }
          : { status: 200, headers: { 'content-length': '6' }, data: Readable.from(['abcdef']) }
      }
      await doResumableDownload({
        url: 'https://example.com/file.bin',
        filepath,
        timeout: 1000,
        allowedMimeTypes: [],
      })
      assert.equal(await readFile(filepath, 'utf8'), 'abcdef')
      assert.deepEqual(requests, ['bytes=3-', undefined])
    } finally {
      axios.head = head
      axios.get = get
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('abort preserves an installed file and prevents completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-abort-'))
  const filepath = join(directory, 'file.bin')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filepath, 'previous')
  const head = axios.head
  const get = axios.get
  const controller = new AbortController()
  let completed = false
  try {
    ;(axios as any).head = async () => ({ headers: { 'content-length': '4' } })
    ;(axios as any).get = async () => {
      controller.abort()
      return { status: 200, headers: { 'content-length': '4' }, data: Readable.from(['test']) }
    }
    await assert.rejects(
      doResumableDownload({
        url: 'https://example.com/file.bin',
        filepath,
        timeout: 1000,
        allowedMimeTypes: [],
        forceNew: true,
        signal: controller.signal,
        onComplete: () => {
          completed = true
        },
      })
    )
    assert.equal(completed, false)
    assert.equal(await readFile(filepath, 'utf8'), 'previous')
  } finally {
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('low disk space stops before GET and preserves installed content', async () => {
  const { default: fs } = await import('node:fs/promises')
  const originalStatfs = fs.statfs
  const head = axios.head
  const get = axios.get
  const directory = await mkdtemp(join(tmpdir(), 'nomad-disk-'))
  const filepath = join(directory, 'file.bin')
  await fs.writeFile(filepath, 'installed')
  let gets = 0
  try {
    ;(fs as any).statfs = async () => ({ bsize: 1, bavail: 2 * 1024 ** 3 + 3 })
    ;(axios as any).head = async () => ({ headers: { 'content-length': '4' } })
    ;(axios as any).get = async () => {
      gets++
      throw new Error('must not request GET')
    }
    await assert.rejects(
      doResumableDownload({
        url: 'https://example.com/test',
        filepath,
        timeout: 1000,
        allowedMimeTypes: [],
        forceNew: true,
      }),
      /free disk space/
    )
    assert.equal(gets, 0)
    assert.equal(await readFile(filepath, 'utf8'), 'installed')
  } finally {
    fs.statfs = originalStatfs
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('a matching suffix resumes without fetching the prefix', async () => {
  const fs = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'nomad-matching-'))
  const filepath = join(directory, 'file.bin')
  await fs.writeFile(filepath + '.tmp', 'abc')
  await fs.writeFile(
    filepath + '.tmp.source',
    createHash('sha256').update('https://example.com/test').digest('hex')
  )
  const head = axios.head
  const get = axios.get
  try {
    ;(axios as any).head = async () => ({
      headers: { 'content-length': '6', 'accept-ranges': 'bytes' },
    })
    ;(axios as any).get = async (_url: string, config: any) => {
      assert.equal(config.headers.Range, 'bytes=3-')
      return {
        status: 206,
        headers: { 'content-range': 'bytes 3-5/6', 'content-length': '3' },
        data: Readable.from(['def']),
      }
    }
    await doResumableDownload({
      url: 'https://example.com/test',
      filepath,
      timeout: 1000,
      allowedMimeTypes: [],
    })
    assert.equal(await readFile(filepath, 'utf8'), 'abcdef')
  } finally {
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('GET entitlement rejection is terminal just like HEAD rejection', async () => {
  const head = axios.head
  const get = axios.get
  const directory = await mkdtemp(join(tmpdir(), 'nomad-auth-'))
  try {
    ;(axios as any).head = async () => ({ headers: { 'content-length': '6' } })
    ;(axios as any).get = async () => {
      throw Object.assign(new Error('HTTP 403'), { response: { status: 403 } })
    }
    await assert.rejects(
      doResumableDownload({
        url: 'https://example.com/test',
        filepath: join(directory, 'file'),
        timeout: 1000,
        allowedMimeTypes: [],
      }),
      { name: 'GatedContentAuthError' }
    )
  } finally {
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('discarded partials are reclaimed before checking replacement space', async () => {
  const { default: fs } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'nomad-stale-partial-'))
  const filepath = join(directory, 'file.bin')
  await fs.writeFile(filepath + '.tmp', 'oldpartial')
  const statfs = fs.statfs
  const head = axios.head
  const get = axios.get
  try {
    ;(fs as any).statfs = async () => {
      const size = await fs
        .stat(filepath + '.tmp')
        .then((s) => s.size)
        .catch(() => 0)
      return { bsize: 1, bavail: 2 * 1024 ** 3 + 13 - size }
    }
    ;(axios as any).head = async () => ({ headers: { 'content-length': '4' } })
    ;(axios as any).get = async () => ({ status: 200, headers: {}, data: Readable.from(['good']) })
    await doResumableDownload({
      url: 'https://example.com/test',
      filepath,
      timeout: 1000,
      allowedMimeTypes: [],
    })
    assert.equal(await readFile(filepath, 'utf8'), 'good')
  } finally {
    fs.statfs = statfs
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('a second source cannot write the same destination during a transfer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-concurrent-download-'))
  const filepath = join(directory, 'file.bin')
  const head = axios.head
  const get = axios.get
  let release!: () => void
  let entered!: () => void
  const paused = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  let first: Promise<string> | undefined
  try {
    ;(axios as any).head = async () => ({ headers: { 'content-length': '4' } })
    ;(axios as any).get = async (url: string) => ({
      status: 200,
      headers: {},
      data: Readable.from([url.includes('first') ? 'AAAA' : 'BBBB']),
    })
    const params = { filepath, timeout: 1000, allowedMimeTypes: [], forceNew: true }
    first = doResumableDownload({
      ...params,
      url: 'https://example.com/first',
      onProgress: async () => {
        entered()
        await paused
      },
    })
    await ready
    await assert.rejects(doResumableDownload({ ...params, url: 'https://example.com/second' }), {
      code: 'ELOCKED',
    })
    release()
    await first
    assert.equal(await readFile(filepath, 'utf8'), 'AAAA')
    await doResumableDownload({ ...params, url: 'https://example.com/second' })
    assert.equal(await readFile(filepath, 'utf8'), 'BBBB')
  } finally {
    release()
    await first?.catch(() => {})
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('a new source never resumes another source partial bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-source-partial-'))
  const filepath = join(directory, 'file.bin')
  const head = axios.head
  const get = axios.get
  try {
    ;(axios as any).head = async () => ({
      headers: { 'content-length': '8', 'accept-ranges': 'bytes' },
    })
    ;(axios as any).get = async (url: string, config: any) => {
      if (url.includes('source-a')) {
        return {
          status: 200,
          headers: {},
          data: Readable.from(
            (async function* () {
              yield Buffer.from('AAAA')
              await new Promise((resolve) => setTimeout(resolve, 20))
              throw Object.assign(new Error('interrupted'), { code: 'ECONNRESET' })
            })()
          ),
        }
      }
      assert.equal(config.headers.Range, undefined, 'a different source must start from zero')
      return { status: 200, headers: {}, data: Readable.from(['BBBBbbbb']) }
    }
    const params = { filepath, timeout: 1000, allowedMimeTypes: [] }
    await assert.rejects(
      doResumableDownload({ ...params, url: 'https://source-a.example/file.bin' }),
      /interrupted/
    )
    assert.equal(await readFile(filepath + '.tmp', 'utf8'), 'AAAA')
    await doResumableDownload({ ...params, url: 'https://source-b.example/file.bin' })
    assert.equal(await readFile(filepath, 'utf8'), 'BBBBbbbb')
  } finally {
    axios.head = head
    axios.get = get
    await rm(directory, { recursive: true, force: true })
  }
})

test('downloads check resolved addresses at connection time for HEAD and GET', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nomad-download-address-'))
  const filepath = join(directory, 'file.bin')
  const originalHead = axios.head
  const originalGet = axios.get
  let checked = 0

  const checkOptions = async (options: any) => {
    assert.equal(options.proxy, false)
    assert.equal(typeof options.httpAgent?.options?.lookup, 'function')
    assert.equal(typeof options.httpsAgent?.options?.lookup, 'function')
    await new Promise<void>((resolve, reject) => {
      options.httpAgent.options.lookup('localhost', { all: false }, (error: Error | null) => {
        if (!error) return reject(new Error('Loopback DNS result was accepted'))
        resolve()
      })
    })
    checked++
  }

  try {
    ;(axios as any).head = async (_url: string, options: any) => {
      await checkOptions(options)
      return { headers: { 'content-length': '5', 'content-type': 'application/octet-stream' } }
    }
    ;(axios as any).get = async (_url: string, options: any) => {
      await checkOptions(options)
      return { status: 200, data: Readable.from([Buffer.from('hello')]) }
    }

    await doResumableDownload({
      url: 'https://example.com/file.bin',
      filepath,
      timeout: 30000,
      allowedMimeTypes: [],
    })
    assert.equal(checked, 2)
  } finally {
    ;(axios as any).head = originalHead
    ;(axios as any).get = originalGet
    await rm(directory, { recursive: true, force: true })
  }
})
