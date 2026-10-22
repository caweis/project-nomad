import { BaseStylesFile, MapLayer } from '../../types/maps.js'
import {
  DownloadRemoteSuccessCallback,
  FileEntry,
} from '../../types/files.js'
import { doResumableDownloadWithRetry } from '../utils/downloads.js'
import { filenameFromDownloadUrl } from '../utils/download_filename.js'
import { downloadUrlOriginForLog } from '../utils/download_url_log.js'
import { extract } from 'tar'
import env from '#start/env'
import {
  listDirectoryContentsRecursive,
  getFileStatsIfExists,
  deleteFileIfExists,
  getFile,
  ensureDirectoryExists,
} from '../utils/fs.js'
import { join, resolve, sep } from 'path'
import { rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import axios from 'axios'
import urlJoin from 'url-join'
import { RunDownloadJob } from '#jobs/run_download_job'
import logger from '@adonisjs/core/services/logger'
import { assertNotPrivateUrl, assertSafeRedirectTarget } from '#validators/common'
import InstalledResource from '#models/installed_resource'
import { CollectionManifestService } from './collection_manifest_service.js'
import { pickNewestPerRegion, type MapRegionEntry } from '../utils/map_region_dedup.js'
import { decideSupersededDeletion } from '../utils/superseded_resource.js'
import type { CollectionWithStatus, MapsSpec } from '../../types/collections.js'
import {
  latestProtomapsBuild,
  PMTILES_BINARY_PATH,
  PROTOMAPS_BUILDS_METADATA_URL,
  WORLD_BASEMAP_FILENAME,
  WORLD_BASEMAP_SOURCE_NAME,
  worldBasemapExtractArgs,
} from '../../constants/world_basemap.js'

const execFileAsync = promisify(execFile)
let worldBasemapInFlight: Promise<void> | null = null

const BASE_ASSETS_MIME_TYPES = [
  'application/gzip',
  'application/x-gzip',
  'application/octet-stream',
]

const PMTILES_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
const PMTILES_MIME_TYPES = ['application/vnd.pmtiles', 'application/octet-stream']

interface IMapService {
  downloadRemoteSuccessCallback: DownloadRemoteSuccessCallback
}

export class MapService implements IMapService {
  private readonly mapStoragePath = '/storage/maps'
  private readonly baseStylesFile = 'nomad-base-styles.json'
  private readonly basemapsAssetsDir = 'basemaps-assets'
  private readonly baseAssetsTarFile = 'base-assets.tar.gz'
  private readonly baseDirPath = join(process.cwd(), this.mapStoragePath)
  private baseAssetsExistCache: boolean | null = null

  async listRegions() {
    const files = (await this.listAllMapStorageItems()).filter(
      (item) => item.type === 'file' && item.name.endsWith('.pmtiles') && item.name !== WORLD_BASEMAP_FILENAME
    )

    return {
      files,
    }
  }

  async downloadBaseAssets(url?: string) {
    const tempTarPath = join(this.baseDirPath, this.baseAssetsTarFile)

    const defaultTarFileURL = new URL(
      this.baseAssetsTarFile,
      'https://github.com/Crosstalk-Solutions/project-nomad-maps/raw/refs/heads/master/'
    )

    const resolvedURL = url ? new URL(url) : defaultTarFileURL
    await doResumableDownloadWithRetry({
      url: resolvedURL.toString(),
      filepath: tempTarPath,
      timeout: 30000,
      max_retries: 2,
      allowedMimeTypes: BASE_ASSETS_MIME_TYPES,
      onAttemptError(error, attempt) {
        console.error(`Attempt ${attempt} to download tar file failed (${error.name})`)
      },
    })
    const tarFileBuffer = await getFileStatsIfExists(tempTarPath)
    if (!tarFileBuffer) {
      throw new Error(`Failed to download tar file`)
    }

    await extract({
      cwd: join(process.cwd(), this.mapStoragePath),
      file: tempTarPath,
      strip: 1,
    })

    await deleteFileIfExists(tempTarPath)

    // Invalidate cache since we just downloaded new assets
    this.baseAssetsExistCache = true

    return true
  }

  async downloadCollection(slug: string): Promise<string[] | null> {
    const manifestService = new CollectionManifestService()
    const spec = await manifestService.getSpecWithFallback<MapsSpec>('maps')
    if (!spec) return null

    const collection = spec.collections.find((c) => c.slug === slug)
    if (!collection) return null

    // Filter out already installed
    const installed = await InstalledResource.query().where('resource_type', 'map')
    const installedIds = new Set(installed.map((r) => r.resource_id))
    const toDownload = collection.resources.filter((r) => !installedIds.has(r.id))

    if (toDownload.length === 0) return null

    const downloadFilenames: string[] = []

    for (const resource of toDownload) {
      // SSRF guard: refuse to download from private/loopback addresses.
      // Ports the security part of upstream 806b2c1.
      try {
        assertNotPrivateUrl(resource.url)
      } catch {
        logger.warn(
          `[MapService] Blocked download from private/loopback origin: ${downloadUrlOriginForLog(resource.url)}`
        )
        continue
      }

      const existing = await RunDownloadJob.getActiveByUrl(resource.url)
      if (existing) {
        logger.warn(
          `[MapService] Download already in progress from ${downloadUrlOriginForLog(resource.url)}, skipping.`
        )
        continue
      }

      const filename = filenameFromDownloadUrl(resource.url)
      if (!filename) {
        logger.warn(
          `[MapService] Could not determine filename from ${downloadUrlOriginForLog(resource.url)}, skipping.`
        )
        continue
      }

      downloadFilenames.push(filename)
      const filepath = join(process.cwd(), this.mapStoragePath, 'pmtiles', filename)

      await RunDownloadJob.dispatch({
        url: resource.url,
        filepath,
        timeout: 30000,
        allowedMimeTypes: PMTILES_MIME_TYPES,
        forceNew: true,
        filetype: 'map',
        resourceMetadata: {
          resource_id: resource.id,
          version: resource.version,
          collection_ref: slug,
        },
      })
    }

    return downloadFilenames.length > 0 ? downloadFilenames : null
  }

  async downloadRemoteSuccessCallback(urls: string[], _: boolean) {
    // Create InstalledResource entries for downloaded map files
    for (const url of urls) {
      const filename = filenameFromDownloadUrl(url)
      if (!filename) continue

      const parsed = CollectionManifestService.parseMapFilename(filename)
      if (!parsed) continue

      const pmtilesDir = join(process.cwd(), this.mapStoragePath, 'pmtiles')
      const filepath = join(pmtilesDir, filename)
      const stats = await getFileStatsIfExists(filepath)

      try {
        // Capture the prior install for this resource_id before updateOrCreate
        // repoints it, so we know the old file to clean up (#858).
        const prior = await InstalledResource.query()
          .where('resource_id', parsed.resource_id)
          .where('resource_type', 'map')
          .first()

        const { DateTime } = await import('luxon')
        await InstalledResource.updateOrCreate(
          { resource_id: parsed.resource_id, resource_type: 'map' },
          {
            version: parsed.version,
            url: url,
            file_path: filepath,
            file_size_bytes: stats ? Number(stats.size) : null,
            installed_at: DateTime.now(),
          }
        )
        logger.info('[MapService] Created InstalledResource entry')

        // Remove the superseded prior version's file if every safety rail passes.
        // Maps have no library index, so deleting the recorded old file is enough.
        const decision = decideSupersededDeletion({
          existing: prior ? { file_path: prior.file_path, version: prior.version } : null,
          newFilePath: filepath,
          newVersion: parsed.version,
          newFileExists: !!stats,
          storageBaseDir: pmtilesDir,
        })
        if (decision.delete && decision.path) {
          try {
            await deleteFileIfExists(decision.path)
            logger.info('[MapService] Removed superseded file')
          } catch (err) {
            logger.error('[MapService] Failed to remove superseded file')
            throw err
          }
        }
      } catch (error) {
        logger.error('[MapService] Failed to create InstalledResource')
        throw error
      }
    }
  }

  async downloadRemote(url: string): Promise<{ filename: string; jobId?: string }> {
    const parsed = new URL(url)
    if (!parsed.pathname.endsWith('.pmtiles')) {
      throw new Error(
        `Invalid PMTiles file URL from ${downloadUrlOriginForLog(url)}. URL must end with .pmtiles`
      )
    }

    const filename = filenameFromDownloadUrl(url)
    if (!filename) {
      throw new Error('Could not determine filename from URL')
    }

    const filepath = join(process.cwd(), this.mapStoragePath, 'pmtiles', filename)

    // First, ensure base assets are present - regions depend on them
    const baseAssetsExist = await this.ensureBaseAssets()
    if (!baseAssetsExist) {
      throw new Error(
        'Base map assets are missing and could not be downloaded. Please check your connection and try again.'
      )
    }

    // Guard AFTER ensureBaseAssets: getActiveByUrl purges a stale failed job,
    // so it must be the last check before dispatch — purging and then failing
    // on base assets would strip the Downloads-page failed row (and its Retry)
    // without dispatching a replacement.
    const existing = await RunDownloadJob.getActiveByUrl(url)
    if (existing) {
      throw new Error(`Download already in progress from ${downloadUrlOriginForLog(url)}`)
    }

    // Parse resource metadata
    const parsedFilename = CollectionManifestService.parseMapFilename(filename)
    const resourceMetadata = parsedFilename
      ? { resource_id: parsedFilename.resource_id, version: parsedFilename.version, collection_ref: null }
      : undefined

    // Dispatch background job
    const result = await RunDownloadJob.dispatch({
      url,
      filepath,
      timeout: 30000,
      allowedMimeTypes: PMTILES_MIME_TYPES,
      forceNew: true,
      filetype: 'map',
      resourceMetadata,
    })

    if (!result.job) {
      throw new Error('Failed to dispatch download job')
    }

    logger.info(
      `[MapService] Dispatched download job ${result.job.id} from ${downloadUrlOriginForLog(url)}`
    )

    return {
      filename,
      jobId: result.job?.id,
    }
  }

  async downloadRemotePreflight(
    url: string
  ): Promise<{ filename: string; size: number } | { message: string }> {
    try {
      assertNotPrivateUrl(url)
      const parsed = new URL(url)
      if (!parsed.pathname.endsWith('.pmtiles')) {
        throw new Error(
          `Invalid PMTiles file URL from ${downloadUrlOriginForLog(url)}. URL must end with .pmtiles`
        )
      }

      const filename = filenameFromDownloadUrl(url)
      if (!filename) {
        throw new Error('Could not determine filename from URL')
      }

      // Perform a HEAD request to get the content length
      const response = await axios.head(url, {
        timeout: 30_000,
        beforeRedirect: assertSafeRedirectTarget,
      })

      if (response.status !== 200) {
        throw new Error(`Failed to fetch file info: HTTP ${response.status}`)
      }

      const contentLength = response.headers['content-length']
      const size = contentLength ? parseInt(String(contentLength), 10) : 0

      return { filename, size }
    } catch {
      logger.error('[MapService] Preflight check failed for URL')
      return { message: 'Preflight check failed. Please verify the URL is valid and accessible.' }
    }
  }

  async generateStylesJSON(host: string | null = null): Promise<BaseStylesFile> {
    if (!(await this.checkBaseAssetsExist())) {
      throw new Error('Base map assets are missing from storage/maps')
    }

    const baseStylePath = join(this.baseDirPath, this.baseStylesFile)
    const baseStyle = await getFile(baseStylePath, 'string')
    if (!baseStyle) {
      throw new Error('Base styles file not found in storage/maps')
    }

    const rawStyles = JSON.parse(baseStyle.toString()) as BaseStylesFile

    const regions = (await this.listRegions()).files

    /** If we have the host, use it to build public URLs, otherwise we'll fallback to defaults
    * This is mainly useful because we need to know what host the user is accessing from in order to
    * properly generate URLs in the styles file
    * e.g. user is accessing from "example.com", but we would by default generate "localhost:8080/..." so maps would
    * fail to load.
    */
    const sources = this.generateSourcesArray(host, regions, await this.checkWorldBasemapExists())
    const baseUrl = this.getPublicFileBaseUrl(host, this.basemapsAssetsDir)

    const styles = await this.generateStylesFile(
      rawStyles,
      sources,
      urlJoin(baseUrl, 'sprites/v4/light'),
      urlJoin(baseUrl, 'fonts/{fontstack}/{range}.pbf')
    )

    return styles
  }

  async listCuratedCollections(): Promise<CollectionWithStatus[]> {
    const manifestService = new CollectionManifestService()
    return manifestService.getMapCollectionsWithStatus()
  }

  async fetchLatestCollections(): Promise<boolean> {
    const manifestService = new CollectionManifestService()
    return manifestService.fetchAndCacheSpec('maps')
  }

  async ensureBaseAssets(): Promise<boolean> {
    if (!(await this.ensureBaseAssetFiles())) return false
    try {
      await this.ensureWorldBasemap()
    } catch (error) {
      logger.warn(`[MapService] World basemap is unavailable: ${error instanceof Error ? error.message : error}`)
    }
    return true
  }

  private async ensureBaseAssetFiles(): Promise<boolean> {
    return (await this.checkBaseAssetsExist()) || this.downloadBaseAssets()
  }

  async checkWorldBasemapExists(): Promise<boolean> {
    const file = resolve(join(this.baseDirPath, 'pmtiles', WORLD_BASEMAP_FILENAME))
    const stats = await getFileStatsIfExists(file)
    return !!stats && Number(stats.size) > 0
  }

  async provisionWorldBasemap(): Promise<boolean> {
    // The ordinary ensureBaseAssets path already attempts extraction. Calling it
    // again here would duplicate a failed extraction on a single button press.
    if (!(await this.ensureBaseAssetFiles())) return false
    await this.ensureWorldBasemap()
    return this.checkWorldBasemapExists()
  }

  private async ensureWorldBasemap(): Promise<void> {
    if (await this.checkWorldBasemapExists()) return
    if (worldBasemapInFlight) return worldBasemapInFlight
    worldBasemapInFlight = this.setupWorldBasemap().finally(() => {
      worldBasemapInFlight = null
    })
    return worldBasemapInFlight
  }

  private async setupWorldBasemap(): Promise<void> {
    const dir = resolve(join(this.baseDirPath, 'pmtiles'))
    const target = resolve(join(dir, WORLD_BASEMAP_FILENAME))
    const partial = resolve(join(dir, `world-${randomUUID()}.partial`))
    if (!target.startsWith(dir + sep) || !partial.startsWith(dir + sep)) {
      throw new Error('Invalid world basemap path')
    }
    await ensureDirectoryExists(dir)
    try {
      const response = await axios.get(PROTOMAPS_BUILDS_METADATA_URL, { timeout: 15_000 })
      const build = latestProtomapsBuild(response.data)
      await execFileAsync(PMTILES_BINARY_PATH, worldBasemapExtractArgs(build.url, partial), {
        timeout: 5 * 60_000,
        maxBuffer: 256 * 1024,
      })
      const stats = await getFileStatsIfExists(partial)
      if (!stats || Number(stats.size) === 0) throw new Error('World basemap extraction produced no data')
      await rename(partial, target)
    } finally {
      await deleteFileIfExists(partial)
    }
  }

  private async checkBaseAssetsExist(useCache: boolean = true): Promise<boolean> {
    // Return cached result if available and caching is enabled
    if (useCache && this.baseAssetsExistCache !== null) {
      return this.baseAssetsExistCache
    }

    await ensureDirectoryExists(this.baseDirPath)

    const baseStylePath = join(this.baseDirPath, this.baseStylesFile)
    const basemapsAssetsPath = join(this.baseDirPath, this.basemapsAssetsDir)

    const [baseStyleExists, basemapsAssetsExists] = await Promise.all([
      getFileStatsIfExists(baseStylePath),
      getFileStatsIfExists(basemapsAssetsPath),
    ])

    const exists = !!baseStyleExists && !!basemapsAssetsExists

    // update cache
    this.baseAssetsExistCache = exists

    return exists
  }

  private async listAllMapStorageItems(): Promise<FileEntry[]> {
    await ensureDirectoryExists(this.baseDirPath)
    return await listDirectoryContentsRecursive(this.baseDirPath)
  }

  private generateSourcesArray(host: string | null, regions: FileEntry[], worldExists = false): BaseStylesFile['sources'][] {
    const sources: BaseStylesFile['sources'][] = []
    const baseUrl = this.getPublicFileBaseUrl(host, 'pmtiles')
    if (worldExists) {
      sources.push({
        [WORLD_BASEMAP_SOURCE_NAME]: {
          type: 'vector',
          attribution: PMTILES_ATTRIBUTION,
          url: `pmtiles://${urlJoin(baseUrl, WORLD_BASEMAP_FILENAME)}`,
        },
      })
    }

    // Dedupe by region, keeping only the newest file per region. Both
    // "washington.pmtiles" and "washington_2025-12.pmtiles" reduce to the region
    // "washington"; emitting both produces duplicate source keys and duplicate
    // layer ids (generateStylesFile derives the layer id from the source key),
    // which MapLibre rejects — blanking the ENTIRE map. Old copies linger when a
    // newer curated version installs (#634), so guard against it here too.
    const entries: MapRegionEntry[] = regions
      .filter((region) => region.type === 'file' && region.name.endsWith('.pmtiles'))
      .map((region) => {
        const parsed = CollectionManifestService.parseMapFilename(region.name)
        return {
          name: region.name,
          regionName: parsed ? parsed.resource_id : region.name.replace('.pmtiles', ''),
          version: parsed ? parsed.version : null,
        }
      })

    const deduped = pickNewestPerRegion(entries, () => {
      logger.warn('[MapService] Duplicate map region; keeping newest file')
    })

    for (const entry of deduped) {
      const source: BaseStylesFile['sources'] = {}
      const sourceUrl = urlJoin(baseUrl, entry.name)

      source[entry.regionName] = {
        type: 'vector',
        attribution: PMTILES_ATTRIBUTION,
        url: `pmtiles://${sourceUrl}`,
      }
      sources.push(source)
    }

    return sources
  }

  private async generateStylesFile(
    template: BaseStylesFile,
    sources: BaseStylesFile['sources'][],
    sprites: string,
    glyphs: string
  ): Promise<BaseStylesFile> {
    const layersTemplates = template.layers.filter((layer) => layer.source)
    const withoutSources = template.layers.filter((layer) => !layer.source)

    template.sources = {} // Clear existing sources
    template.layers = [...withoutSources] // Start with layers that don't depend on sources

    for (const source of sources) {
      for (const layerTemplate of layersTemplates) {
        const layer: MapLayer = {
          ...layerTemplate,
          id: `${layerTemplate.id}-${Object.keys(source)[0]}`,
          type: layerTemplate.type,
          source: Object.keys(source)[0],
        }
        template.layers.push(layer)
      }

      template.sources = Object.assign(template.sources, source)
    }

    template.sprite = sprites
    template.glyphs = glyphs

    return template
  }

  async delete(file: string): Promise<void> {
    let fileName = file
    if (!fileName.endsWith('.pmtiles')) {
      fileName += '.pmtiles'
    }
    if (fileName === WORLD_BASEMAP_FILENAME) throw new Error('Base map cannot be deleted as a region')

    const basePath = resolve(join(this.baseDirPath, 'pmtiles'))
    const fullPath = resolve(join(basePath, fileName))

    // Prevent path traversal — resolved path must stay within the storage directory
    if (!fullPath.startsWith(basePath + sep)) {
      throw new Error('Invalid filename')
    }

    const exists = await getFileStatsIfExists(fullPath)
    if (!exists) {
      throw new Error('not_found')
    }

    await deleteFileIfExists(fullPath)

    // Clean up InstalledResource entry
    const parsed = CollectionManifestService.parseMapFilename(fileName)
    if (parsed) {
      await InstalledResource.query()
        .where('resource_id', parsed.resource_id)
        .where('resource_type', 'map')
        .delete()
      logger.info('[MapService] Deleted InstalledResource entry')
    }
  }

  /*
   * Gets the appropriate public URL for a map asset depending on environment
   */
  private getPublicFileBaseUrl(specifiedHost: string | null, childPath: string): string {
    function getHost() {
      try {
        const localUrlRaw = env.get('URL')
        if (!localUrlRaw) return 'localhost'

        const localUrl = new URL(localUrlRaw)
        return localUrl.host
      } catch (error) {
        return 'localhost'
      }
    }

    const host = specifiedHost || getHost()
    const withProtocol = host.startsWith('http') ? host : `http://${host}`
    const baseUrlPath =
      process.env.NODE_ENV === 'production' ? childPath : urlJoin(this.mapStoragePath, childPath)

    const baseUrl = new URL(baseUrlPath, withProtocol).toString()
    return baseUrl
  }
}
