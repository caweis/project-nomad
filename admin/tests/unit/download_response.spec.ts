import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import axios from 'axios'
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
