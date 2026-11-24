import { test } from '@japa/runner'
import { HttpContextFactory, RequestFactory, ResponseFactory } from '@adonisjs/core/factories/http'
import CorsMiddleware from '@adonisjs/cors/cors_middleware'
import StaticMiddleware from '@adonisjs/static/static_middleware'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MapsCorsMiddleware from '#middleware/maps_cors_middleware'
import corsConfig from '#config/cors'
import staticConfig from '#config/static'

const origin = 'https://map-reader.example'
const mapPaths = [
  '/api/maps/styles',
  '/pmtiles/washington.pmtiles',
  '/basemaps-assets/fonts/Noto%20Sans%20Regular/0-255.pbf',
  '/basemaps-assets/sprites/v4/light.json',
  '/storage/maps/pmtiles/washington.pmtiles',
]

async function handle(path: string, method = 'GET', requestedMethod?: string, status = 200) {
  const request = new RequestFactory().merge({ url: path, method }).create()
  request.request.headers.origin = origin
  if (requestedMethod) {
    request.request.headers['access-control-request-method'] = requestedMethod
    request.request.headers['access-control-request-headers'] = 'Range, If-None-Match, If-Match'
  }
  const ctx = new HttpContextFactory().merge({ request }).create()
  ctx.response.vary('Accept-Encoding')
  let reachedAsset = false
  await new MapsCorsMiddleware().handle(ctx, () =>
    new CorsMiddleware({ ...corsConfig }).handle(ctx, async () => {
      reachedAsset = true
      ctx.response.status(status).send('map asset')
    })
  )
  return { response: ctx.response, reachedAsset }
}

test.group('map asset CORS', () => {
  test('allows anonymous GET and HEAD access to styles and static map assets', async ({
    assert,
  }) => {
    for (const path of mapPaths) {
      for (const method of ['GET', 'HEAD']) {
        const { response, reachedAsset } = await handle(path, method)
        assert.equal(response.getHeader('Access-Control-Allow-Origin'), '*', `${method} ${path}`)
        assert.isUndefined(response.getHeader('Access-Control-Allow-Credentials'))
        assert.isTrue(reachedAsset)
      }
    }
  })

  test('exposes byte-range and cache headers without replacing Vary', async ({ assert }) => {
    const { response } = await handle('/pmtiles/washington.pmtiles')
    assert.equal(
      response.getHeader('Access-Control-Expose-Headers'),
      'ETag, Content-Range, Accept-Ranges, Content-Length'
    )
    assert.equal(response.getHeader('Vary'), 'Accept-Encoding, Origin')
  })

  test('answers GET and HEAD preflights before the global CORS middleware', async ({ assert }) => {
    for (const path of mapPaths) {
      for (const requestedMethod of ['GET', 'HEAD']) {
        const { response, reachedAsset } = await handle(path, 'OPTIONS', requestedMethod)
        assert.equal(response.getStatus(), 204)
        assert.equal(response.getHeader('Access-Control-Allow-Origin'), '*')
        assert.equal(response.getHeader('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS')
        assert.equal(
          response.getHeader('Access-Control-Allow-Headers'),
          'Range, If-None-Match, If-Match'
        )
        assert.equal(response.getHeader('Access-Control-Max-Age'), '600')
        assert.isUndefined(response.getHeader('Access-Control-Allow-Credentials'))
        assert.isFalse(reachedAsset)
      }
    }
  })

  test('does not expose other API routes or near-miss asset prefixes', async ({ assert }) => {
    for (const path of [
      '/api/system/info',
      '/api/maps',
      '/api/mapsfoo',
      '/api/maps/styles/other',
      '/api/maps/regions',
      '/api/maps/markers',
      '/api/maps/download-remote',
      '/api/maps/extract-preflight',
      '/api/maps/setup-world-basemap',
      '/maps',
      '/',
      '/pmtiles',
      '/basemaps-assets',
      '/storage/maps',
    ]) {
      for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
        const { response } = await handle(path, method, 'GET')
        assert.isUndefined(response.getHeader('Access-Control-Allow-Origin'), `${method} ${path}`)
      }
    }
  })

  test('does not expose paths that escape a map directory after decoding', async ({ assert }) => {
    for (const path of [
      '/pmtiles/..%2Fstyles/app.css',
      '/pmtiles/%2E%2E%2Ffavicon.ico',
      '/basemaps-assets/..%2F..%2Fapi/maps/regions',
      '/storage/maps/..%2F..%2Fstyles/app.css',
      '/pmtiles/../styles/app.css',
      '/pmtiles/%E0%A4%A',
    ]) {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const { response } = await handle(path, method, 'GET')
        assert.isUndefined(response.getHeader('Access-Control-Allow-Origin'), `${method} ${path}`)
      }
    }
  })

  test('keeps error bodies same-origin and retains successful range and cache responses', async ({
    assert,
  }) => {
    for (const status of [400, 403, 404, 416, 500, 503]) {
      const { response } = await handle('/api/maps/styles', 'GET', undefined, status)
      assert.isUndefined(response.getHeader('Access-Control-Allow-Origin'), `status ${status}`)
    }
    for (const status of [200, 206, 304]) {
      const { response } = await handle('/api/maps/styles', 'GET', undefined, status)
      assert.equal(response.getHeader('Access-Control-Allow-Origin'), '*', `status ${status}`)
    }
  })

  test('clears anonymous read access if the downstream handler throws', async ({ assert }) => {
    const request = new RequestFactory().merge({ url: '/api/maps/styles', method: 'GET' }).create()
    const ctx = new HttpContextFactory().merge({ request }).create()
    const failure = new Error('map renderer failed')
    await assert.rejects(
      () =>
        new MapsCorsMiddleware().handle(ctx, async () => {
          throw failure
        }),
      failure.message
    )
    assert.isUndefined(ctx.response.getHeader('Access-Control-Allow-Origin'))
  })

  test('does not expose write methods, even on a map asset path', async ({ assert }) => {
    for (const path of mapPaths) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const { response } = await handle(path, method)
        assert.isUndefined(response.getHeader('Access-Control-Allow-Origin'), `${method} ${path}`)
        assert.isUndefined(response.getHeader('Access-Control-Expose-Headers'))
      }
    }
  })

  test('does not grant preflights for write methods or unsupported methods', async ({ assert }) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'OPTIONS']) {
      const { response } = await handle('/api/maps/styles', 'OPTIONS', method)
      assert.isUndefined(response.getHeader('Access-Control-Allow-Origin'), method)
      assert.isUndefined(response.getHeader('Access-Control-Allow-Methods'))
    }
  })

  test('registers map CORS ahead of global CORS and static files', async ({ assert }) => {
    const kernel = await readFile(new URL('../../start/kernel.ts', import.meta.url), 'utf8')
    const mapCors = kernel.indexOf("import('#middleware/maps_cors_middleware')")
    assert.isAbove(mapCors, -1)
    assert.isBelow(mapCors, kernel.indexOf("import('@adonisjs/cors/cors_middleware')"))
    assert.isBelow(mapCors, kernel.indexOf("import('#middleware/maps_static_middleware')"))
  })

  test('serves a ranged tile over HTTP with CORS and an empty preflight response', async ({
    assert,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'nomad-map-cors-'))
    await mkdir(join(directory, 'pmtiles'))
    await writeFile(join(directory, 'pmtiles/test.pmtiles'), '0123456789')
    await writeFile(join(directory, 'private-test.txt'), 'non-map public file')
    const staticFiles = new StaticMiddleware(directory, staticConfig)
    const server = createServer(async (req, res) => {
      const request = new RequestFactory().merge({ req, res }).create()
      const response = new ResponseFactory().merge({ req, res }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()
      try {
        await new MapsCorsMiddleware().handle(ctx, () =>
          new CorsMiddleware({ ...corsConfig }).handle(ctx, () =>
            staticFiles.handle(ctx, async () => response.notFound())
          )
        )
        response.finish()
      } catch {
        res.statusCode = 500
        res.end()
      }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server port')
      const url = `http://127.0.0.1:${address.port}/pmtiles/test.pmtiles`
      const tile = await fetch(url, { headers: { Origin: origin, Range: 'bytes=2-5' } })
      assert.equal(tile.status, 206)
      assert.equal(await tile.text(), '2345')
      assert.equal(tile.headers.get('access-control-allow-origin'), '*')
      assert.equal(tile.headers.get('content-range'), 'bytes 2-5/10')
      assert.equal(tile.headers.get('accept-ranges'), 'bytes')
      assert.isNotNull(tile.headers.get('etag'))
      assert.isNull(tile.headers.get('access-control-allow-credentials'))

      const escaped = await fetch(
        `http://127.0.0.1:${address.port}/pmtiles/..%2Fprivate-test.txt`,
        {
          headers: { Origin: origin },
        }
      )
      assert.equal(escaped.status, 200)
      assert.equal(await escaped.text(), 'non-map public file')
      assert.isNull(escaped.headers.get('access-control-allow-origin'))

      const missing = await fetch(`${url}.missing`, { headers: { Origin: origin } })
      assert.equal(missing.status, 404)
      assert.isNull(missing.headers.get('access-control-allow-origin'))
      await missing.text()

      const preflight = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          'Origin': origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Range',
        },
      })
      assert.equal(preflight.status, 204)
      assert.equal(await preflight.text(), '')
      assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }).timeout(5000)
})
