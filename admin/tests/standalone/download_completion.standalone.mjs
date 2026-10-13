import assert from 'node:assert/strict'
import axios from 'axios'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { doResumableDownload } from '../../build/app/utils/downloads.js'

const originalAdapter = axios.defaults.adapter
const directory = await mkdtemp(join(tmpdir(), 'nomad-download-'))
let passed = 0
let getCount = 0

axios.defaults.adapter = async (config) => {
  if (config.method === 'get') getCount++
  return {
    config,
    data: config.method === 'head' ? '' : Readable.from([Buffer.from('test')]),
    headers: {
      'content-length': '4',
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
    },
    status: 200,
    statusText: 'OK',
  }
}

try {
  const url = 'https://content.example/test.zim'
  const filepath = join(directory, 'test.zim')
  const options = { url, filepath, timeout: 1000, allowedMimeTypes: ['application/octet-stream'] }

  await doResumableDownload(options)
  assert.equal((await readFile(filepath)).toString(), 'test')
  let ordinaryCallbacks = 0
  await doResumableDownload({ ...options, onComplete: async () => { ordinaryCallbacks++ } })
  assert.equal(ordinaryCallbacks, 0, 'ordinary same-size requests keep the existing no-op behavior')
  assert.equal(getCount, 1)
  passed++
  console.log('  ok - ordinary same-size request stays a no-op')

  let callbacks = 0
  await doResumableDownload({
    ...options,
    resumeCompletion: true,
    onComplete: async () => { callbacks++ },
  })
  assert.equal(callbacks, 1, 'retry must run completion against an existing final file')
  assert.equal(getCount, 1)
  passed++
  console.log('  ok - retry completion against existing final file')

  const failedPath = join(directory, 'failure.zim')
  await assert.rejects(
    doResumableDownload({
      ...options,
      filepath: failedPath,
      onComplete: async () => { throw new Error('completion failed') },
    }),
    /completion failed/
  )
  passed++
  console.log('  ok - completion failure rejects the download job')

  let retriedCallbacks = 0
  await doResumableDownload({
    ...options,
    filepath: failedPath,
    resumeCompletion: true,
    onComplete: async () => { retriedCallbacks++ },
  })
  assert.equal(retriedCallbacks, 1)
  assert.equal((await readFile(failedPath)).toString(), 'test')
  assert.equal(getCount, 2, 'retry must not fetch the already-finished file')
  passed++
  console.log('  ok - failed completion retries without downloading the file again')
} finally {
  axios.defaults.adapter = originalAdapter
  await rm(directory, { recursive: true, force: true })
}

console.log(`\n${passed} passed`)
