import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import axios from 'axios'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadRegionalMap,
  regionalMapPointerAfterError,
} from '../../app/utils/regional_map_lfs.js'
import { MapService } from '#services/map_service'
import { RunDownloadJob } from '#jobs/run_download_job'

const url =
  'https://github.com/Crosstalk-Solutions/project-nomad-maps/raw/refs/heads/master/pmtiles/test.pmtiles'
const bytes = Buffer.from('verified map')
const oid = createHash('sha256').update(bytes).digest('hex')
const transport = Object.assign(new Error('transport'), { code: 'EPROTO' })

test.group('regional map LFS recovery', (group) => {
  group.teardown(async () => {
    const { default: config } = await import('#config/queue')
    config.connection.disconnect()
  })
  let adapter: typeof axios.defaults.adapter
  let directory: string
  let signedHost: string
  let payload: Buffer
  let pointer: string
  let requested: string[]
  group.each.setup(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nomad-lfs-'))
    adapter = axios.defaults.adapter
    signedHost = 'https://github-cloud.githubusercontent.com/object?temporary=secret'
    payload = bytes
    pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}`
    requested = []
    axios.defaults.adapter = async (config) => {
      requested.push(config.url!)
      if (config.url === url) throw transport
      assert.equal(config.maxRedirects, 0)
      let data: unknown
      if (config.url?.startsWith('https://raw.githubusercontent.com/')) data = pointer
      else if (config.method === 'post')
        data = {
          objects: [{ oid, size: bytes.length, actions: { download: { href: signedHost } } }],
        }
      else {
        assert.equal(config.method, 'get', 'signed URL must not receive HEAD')
        data = Readable.from([payload])
      }
      return {
        config,
        data,
        status: 200,
        statusText: 'OK',
        headers:
          config.responseType === 'stream'
            ? {
                'content-length': String(payload.length),
                'content-type': 'application/octet-stream',
              }
            : {},
      }
    }
  })
  group.each.teardown(async () => {
    axios.defaults.adapter = adapter
    await rm(directory, { recursive: true, force: true })
  })

  test('preflight and queued download recover and retain the original URL', async () => {
    assert.deepEqual(await new MapService().downloadRemotePreflight(url), {
      filename: 'test.pmtiles',
      size: bytes.length,
    })
    const filepath = join(directory, 'test.pmtiles')
    const original = MapService.prototype.downloadRemoteSuccessCallback
    let completed: string[] = []
    MapService.prototype.downloadRemoteSuccessCallback = async (urls) => {
      completed = urls
    }
    const job = {
      data: {
        url,
        filepath,
        timeout: 1000,
        allowedMimeTypes: ['application/vnd.pmtiles', 'application/octet-stream'],
        filetype: 'map',
      },
      attemptsMade: 0,
      updateProgress: async () => {},
      async updateData(data: any) {
        this.data = data
      },
    }
    try {
      await new RunDownloadJob().handle(job as any)
    } finally {
      MapService.prototype.downloadRemoteSuccessCallback = original
    }
    assert.equal(await readFile(filepath, 'utf8'), bytes.toString())
    assert.deepEqual(completed, [url])
  })
  test('a bad hash leaves installed bytes intact', async () => {
    const filepath = join(directory, 'test.pmtiles')
    await writeFile(filepath, 'existing map')
    payload = Buffer.from('corrupt! map')
    await assert.rejects(
      downloadRegionalMap({ url, filepath, timeout: 1000, allowedMimeTypes: [] }),
      /SHA-256 mismatch/
    )
    assert.equal(await readFile(filepath, 'utf8'), 'existing map')
  })
  test('rejects malformed pointers', async () => {
    pointer = 'version bad\nsize 9007199254740993'
    await assert.rejects(regionalMapPointerAfterError(url, transport), /Invalid upstream/)
  })
  test('rejects alternate signed URL hosts without requesting them', async () => {
    signedHost = 'http://127.0.0.1/secret'
    await assert.rejects(
      downloadRegionalMap({
        url,
        filepath: join(directory, 'map'),
        timeout: 1000,
        allowedMimeTypes: [],
      }),
      /Unexpected GitHub/
    )
    assert.ok(!requested.includes(signedHost))
  })
  test('only the fixed public map endpoint and selected network errors can recover', async () => {
    for (const source of [
      'https://example.com/test.pmtiles',
      url + '?token=secret',
      url.replace('github.com', 'github.com.evil'),
    ]) {
      await assert.rejects(regionalMapPointerAfterError(source, transport), (e) => e === transport)
    }
    const auth = Object.assign(new Error('unauthorized'), { response: { status: 403 } })
    await assert.rejects(regionalMapPointerAfterError(url, auth), (e) => e === auth)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(regionalMapPointerAfterError(url, transport, controller.signal))
    assert.equal(requested.length, 0)
  })
  test('never forwards caller credentials to a fallback source', async () => {
    await assert.rejects(
      downloadRegionalMap({
        url,
        filepath: join(directory, 'map'),
        timeout: 1000,
        allowedMimeTypes: [],
        requestHeaders: { Authorization: 'fixture' },
      }),
      (e) => e === transport
    )
    assert.deepEqual(requested, [url])
  })
})
