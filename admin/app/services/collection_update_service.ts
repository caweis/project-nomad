import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import axios from 'axios'
import InstalledResource from '#models/installed_resource'
import { RunDownloadJob } from '../jobs/run_download_job.js'
import { CollectionManifestService } from './collection_manifest_service.js'
import { ZIM_STORAGE_PATH } from '../utils/fs.js'
import { join } from 'path'
import type {
  ResourceUpdateCheckRequest,
  ResourceUpdateInfo,
  ContentUpdateCheckResult,
} from '../../types/collections.js'
import { NOMAD_API_DEFAULT_BASE_URL } from '../../constants/misc.js'

const MAP_STORAGE_PATH = '/storage/maps'

const ZIM_MIME_TYPES = ['application/x-zim', 'application/x-openzim', 'application/octet-stream']
const PMTILES_MIME_TYPES = ['application/vnd.pmtiles', 'application/octet-stream']

export class CollectionUpdateService {
  async checkForUpdates(): Promise<ContentUpdateCheckResult> {
    const nomadAPIURL = env.get('NOMAD_API_URL') || NOMAD_API_DEFAULT_BASE_URL
    if (!nomadAPIURL) {
      return {
        updates: [],
        checked_at: new Date().toISOString(),
        error: 'Nomad API is not configured. Set the NOMAD_API_URL environment variable.',
      }
    }

    const allInstalled = await InstalledResource.all()

    // Gated self-hosted content (upstream #1172) is versioned by the manifest,
    // not by the update API, so it has no business in this check. Excluding it
    // also means a resource-id collision can't present a third-party file as a
    // "newer version" of gated content — applyUpdate downloads carry no auth
    // header and would silently overwrite it. See resolveZimDownload, which
    // pins the same resources to their manifest URL on the install path.
    const gatedIds = await new CollectionManifestService().getGatedZimResourceIds()
    const installed = allInstalled.filter(
      (r) => !(r.resource_type === 'zim' && gatedIds.has(r.resource_id))
    )

    if (installed.length === 0) {
      return {
        updates: [],
        checked_at: new Date().toISOString(),
      }
    }

    const requestBody: ResourceUpdateCheckRequest = {
      resources: installed.map((r) => ({
        resource_id: r.resource_id,
        resource_type: r.resource_type,
        installed_version: r.version,
      })),
    }

    try {
      const response = await axios.post<ResourceUpdateInfo[]>(`${nomadAPIURL}/api/v1/resources/check-updates`, requestBody, {
        timeout: 15000,
      })

      logger.info(
        `[CollectionUpdateService] Update check complete: ${response.data.length} update(s) available`
      )

      return {
        updates: response.data,
        checked_at: new Date().toISOString(),
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error(
          `[CollectionUpdateService] Nomad API returned ${error.response.status}: ${JSON.stringify(error.response.data)}`
        )
        return {
          updates: [],
          checked_at: new Date().toISOString(),
          error: 'Failed to check for content updates. The update service may be temporarily unavailable.',
        }
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error contacting Nomad API'
      logger.error(`[CollectionUpdateService] Failed to check for updates: ${message}`)
      return {
        updates: [],
        checked_at: new Date().toISOString(),
        error: 'Failed to contact the update service. Please try again later.',
      }
    }
  }

  async applyUpdate(
    update: ResourceUpdateInfo,
    options?: { auto?: boolean }
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    // Check if a download is already in progress for this URL. getActiveByUrl
    // removes a stale failed/completed job first — with the raw getByUrl, a
    // failed job fell through this guard and the dispatch below deduped onto
    // it, reporting success while downloading nothing (upstream #1213).
    const existingJob = await RunDownloadJob.getActiveByUrl(update.download_url)
    if (existingJob) {
      return {
        success: false,
        error: `A download is already in progress for ${update.resource_id}`,
      }
    }

    const filename = this.buildFilename(update)
    const filepath = this.buildFilepath(update, filename)

    const result = await RunDownloadJob.dispatch({
      url: update.download_url,
      filepath,
      timeout: 30000,
      allowedMimeTypes:
        update.resource_type === 'zim' ? ZIM_MIME_TYPES : PMTILES_MIME_TYPES,
      filetype: update.resource_type,
      resourceMetadata: {
        resource_id: update.resource_id,
        version: update.latest_version,
        collection_ref: null,
        auto: options?.auto ?? false,
      },
    })

    if (!result || !result.job) {
      return { success: false, error: 'Failed to dispatch download job' }
    }

    logger.info(
      `[CollectionUpdateService] Dispatched update download for ${update.resource_id}: ${update.installed_version} → ${update.latest_version}`
    )

    return { success: true, jobId: result.job.id }
  }

  async applyAllUpdates(
    updates: ResourceUpdateInfo[]
  ): Promise<{ results: Array<{ resource_id: string; success: boolean; jobId?: string; error?: string }> }> {
    const results: Array<{
      resource_id: string
      success: boolean
      jobId?: string
      error?: string
    }> = []

    for (const update of updates) {
      const result = await this.applyUpdate(update)
      results.push({ resource_id: update.resource_id, ...result })
    }

    return { results }
  }

  private buildFilename(update: ResourceUpdateInfo): string {
    if (update.resource_type === 'zim') {
      return `${update.resource_id}_${update.latest_version}.zim`
    }
    return `${update.resource_id}_${update.latest_version}.pmtiles`
  }

  private buildFilepath(update: ResourceUpdateInfo, filename: string): string {
    if (update.resource_type === 'zim') {
      return join(process.cwd(), ZIM_STORAGE_PATH, filename)
    }
    return join(process.cwd(), MAP_STORAGE_PATH, 'pmtiles', filename)
  }
}
