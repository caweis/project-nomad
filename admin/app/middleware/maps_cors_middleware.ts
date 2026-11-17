import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

const MAP_ASSET_PREFIXES = ['/pmtiles/', '/basemaps-assets/', '/storage/maps/']

/** Anonymous read access for map readers, without opening the write API. */
export default class MapsCorsMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    const path = request.url()
    if (
      path !== '/api/maps/styles' &&
      !MAP_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))
    ) {
      return next()
    }

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

    return next()
  }
}
