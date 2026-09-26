import { MapService } from '#services/map_service'
import MapMarker from '#models/map_marker'
import { createMapMarkerValidator, updateMapMarkerValidator } from '#validators/map_marker'
import {
  assertNotPrivateUrl,
  downloadCollectionValidator,
  filenameParamValidator,
  remoteDownloadValidator,
  remoteDownloadValidatorOptional,
} from '#validators/common'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class MapsController {
  constructor(private mapService: MapService) {}

  async index({ inertia }: HttpContext) {
    const baseAssetsCheck = await this.mapService.ensureBaseAssets()
    const regionFiles = await this.mapService.listRegions()
    return inertia.render('maps', {
      maps: {
        baseAssetsExist: baseAssetsCheck,
        regionFiles: regionFiles.files,
      },
    })
  }

  async downloadBaseAssets({ request }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadValidatorOptional)
    if (payload.url) assertNotPrivateUrl(payload.url)
    await this.mapService.downloadBaseAssets(payload.url)
    return { success: true }
  }

  async downloadRemote({ request }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadValidator)
    assertNotPrivateUrl(payload.url)
    const filename = await this.mapService.downloadRemote(payload.url)
    return {
      message: 'Download started successfully',
      filename,
      url: payload.url,
    }
  }

  async downloadCollection({ request }: HttpContext) {
    const payload = await request.validateUsing(downloadCollectionValidator)
    const resources = await this.mapService.downloadCollection(payload.slug)
    return {
      message: 'Collection download started successfully',
      slug: payload.slug,
      resources,
    }
  }

  // For providing a "preflight" check in the UI before actually starting a background download
  async downloadRemotePreflight({ request }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadValidator)
    assertNotPrivateUrl(payload.url)
    const info = await this.mapService.downloadRemotePreflight(payload.url)
    return info
  }

  async fetchLatestCollections({}: HttpContext) {
    const success = await this.mapService.fetchLatestCollections()
    return { success }
  }

  async listCuratedCollections({}: HttpContext) {
    return await this.mapService.listCuratedCollections()
  }

  async listRegions({}: HttpContext) {
    return await this.mapService.listRegions()
  }

  async styles({ request, response }: HttpContext) {
    // Automatically ensure base assets are present before generating styles
    const baseAssetsExist = await this.mapService.ensureBaseAssets()
    if (!baseAssetsExist) {
      return response.status(500).send({
        message:
          'Base map assets are missing and could not be downloaded. Please check your connection and try again.',
      })
    }

    const styles = await this.mapService.generateStylesJSON(request.host())
    return response.json(styles)
  }

  async delete({ request, response }: HttpContext) {
    const payload = await request.validateUsing(filenameParamValidator)

    try {
      await this.mapService.delete(payload.params.filename)
    } catch (error) {
      if (error.message === 'not_found') {
        return response.status(404).send({
          message: `Map file with key ${payload.params.filename} not found`,
        })
      }
      throw error // Re-throw any other errors and let the global error handler catch
    }

    return {
      message: 'Map file deleted successfully',
    }
  }

  // Map markers (user-placed pins) — ported from upstream v1.33.0; custom color, icon
  // and visibility from v1.35 (a01aa5dc). Validators: validators/map_marker.ts.
  async listMarkers({}: HttpContext) {
    return await MapMarker.query().orderBy('created_at', 'asc')
  }

  async createMarker({ request }: HttpContext) {
    const payload = await request.validateUsing(createMapMarkerValidator)
    const marker = await MapMarker.create({
      name: payload.name,
      longitude: payload.longitude,
      latitude: payload.latitude,
      color: payload.color ?? 'orange',
      custom_color: payload.custom_color ?? null,
      icon: payload.icon ?? null,
      icon_color: payload.icon_color ?? null,
      visible: payload.visible ?? true,
      notes: payload.notes ?? null,
      marker_type: payload.marker_type ?? 'pin',
    })
    return marker
  }

  async updateMarker({ request, response }: HttpContext) {
    const { id } = request.params()
    const marker = await MapMarker.find(id)
    if (!marker) {
      return response.status(404).send({ message: 'Marker not found' })
    }
    const payload = await request.validateUsing(updateMapMarkerValidator)
    if (payload.name !== undefined) marker.name = payload.name
    if (payload.color !== undefined) marker.color = payload.color
    if (payload.custom_color !== undefined) marker.custom_color = payload.custom_color
    if (payload.icon !== undefined) marker.icon = payload.icon
    if (payload.icon_color !== undefined) marker.icon_color = payload.icon_color
    if (payload.visible !== undefined) marker.visible = payload.visible
    if (payload.longitude !== undefined) marker.longitude = payload.longitude
    if (payload.latitude !== undefined) marker.latitude = payload.latitude
    if (payload.notes !== undefined) marker.notes = payload.notes
    if (payload.marker_type !== undefined) marker.marker_type = payload.marker_type
    await marker.save()
    return marker
  }

  async deleteMarker({ request, response }: HttpContext) {
    const { id } = request.params()
    const marker = await MapMarker.find(id)
    if (!marker) {
      return response.status(404).send({ message: 'Marker not found' })
    }
    await marker.delete()
    return { message: 'Marker deleted' }
  }
}
