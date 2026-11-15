import { test } from '@japa/runner'
import { MapService } from '#services/map_service'

test.group('world basemap', () => {
  test('serves installed map assets without starting or waiting for a world download', async ({
    assert,
  }) => {
    const service = new MapService()
    let downloadCalls = 0
    let finishDownload!: () => void
    const pendingDownload = new Promise<void>((resolve) => {
      finishDownload = resolve
    })
    ;(service as any).ensureBaseAssetFiles = async () => true
    ;(service as any).checkWorldBasemapExists = async () => false
    ;(service as any).setupWorldBasemap = async () => {
      downloadCalls++
      await pendingDownload
    }

    const readiness = service.ensureBaseAssets()
    try {
      const readyBeforeDownload = await Promise.race([
        readiness,
        new Promise<'waiting'>((resolve) => setImmediate(() => resolve('waiting'))),
      ])
      assert.isTrue(readyBeforeDownload)
      assert.equal(downloadCalls, 0)
    } finally {
      finishDownload()
      await readiness
    }
  })

  test('adds the world source before regional sources', ({ assert }) => {
    const service = new MapService()
    const sources = (service as any).generateSourcesArray('localhost:8080', [], true)
    assert.equal(Object.keys(sources[0])[0], 'world')
    assert.match(sources[0].world.url, /world\.pmtiles$/)
    assert.deepEqual((service as any).generateSourcesArray('localhost:8080', [], false), [])
  })

  test('two callers share a single in-flight extraction', async ({ assert }) => {
    const first = new MapService()
    const second = new MapService()
    let ready = false
    let calls = 0
    for (const service of [first, second]) {
      ;(service as any).ensureBaseAssetFiles = async () => true
      ;(service as any).checkWorldBasemapExists = async () => ready
      ;(service as any).setupWorldBasemap = async () => {
        calls++
        await new Promise((resolve) => setTimeout(resolve, 10))
        ready = true
      }
    }
    assert.deepEqual(
      await Promise.all([first.provisionWorldBasemap(), second.provisionWorldBasemap()]),
      [true, true]
    )
    assert.equal(calls, 1)
  })
})
