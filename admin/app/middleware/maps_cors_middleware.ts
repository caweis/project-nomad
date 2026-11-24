import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { posix } from 'node:path'

const MAP_ASSET_PREFIXES = ['/pmtiles/', '/basemaps-assets/', '/storage/maps/']

function isMapAssetPath(path: string): boolean {
  return path === '/api/maps/styles' || MAP_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/** Anonymous read access for map readers, without opening the write API. */
export default class MapsCorsMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    // The router uses the original path; static files also decode and normalize it.
    // Both must stay inside the map namespace before granting anonymous access.
    const rawPath = request.url()
    if (!isMapAssetPath(rawPath)) return next()
    let path: string
    try {
      path = posix.normalize(decodeURIComponent(rawPath))
    } catch {
      return next()
    }
    if (!isMapAssetPath(path)) return next()

    const method = request.method()
    const readMethod =
      method === 'OPTIONS' ? request.header('Access-Control-Request-Method') : method
    if (readMethod !== 'GET' && readMethod !== 'HEAD') return next()

    response.safeHeader('Access-Control-Allow-Origin', '*')
    response.header(
      'Access-Control-Expose-Headers',
      'ETag, Content-Range, Accept-Ranges, Content-Length'
    )
    response.vary('Origin')

    if (method === 'OPTIONS') {
      response.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      response.header('Access-Control-Allow-Headers', 'Range, If-None-Match, If-Match')
      response.header('Access-Control-Max-Age', '600')
      return response.status(204).send(null)
    }

    try {
      await next()
    } catch (error) {
      response.removeHeader('Access-Control-Allow-Origin')
      throw error
    }

    // Error pages can contain app metadata; only successful map reads are public.
    if (response.getStatus() >= 400) response.removeHeader('Access-Control-Allow-Origin')
  }
}
