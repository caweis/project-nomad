import { inject } from '@adonisjs/core'
import { ChatRequest, Ollama } from 'ollama'
import { NomadOllamaModel } from '../../types/ollama.js'
import { FALLBACK_RECOMMENDED_OLLAMA_MODELS, MODEL_DESCRIPTION_OVERRIDES } from '../../constants/ollama.js'
import { withMlxPullNames } from '../../util/mlx.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import axios from 'axios'
import { DownloadModelJob } from '#jobs/download_model_job'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import transmit from '@adonisjs/transmit/services/main'
import Fuse, { IFuseOptions } from 'fuse.js'
import { BROADCAST_CHANNELS } from '../../constants/broadcast.js'
import env from '#start/env'
import { NOMAD_API_DEFAULT_BASE_URL } from '../../constants/misc.js'

const NOMAD_MODELS_API_PATH = '/api/v1/ollama/models'
const MODELS_CACHE_FILE = path.join(process.cwd(), 'storage', 'ollama-models-cache.json')
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

@inject()
export class OllamaService {
  private ollama: Ollama | null = null
  private ollamaInitPromise: Promise<void> | null = null

  constructor() { }

  private async _initializeOllamaClient() {
    if (!this.ollamaInitPromise) {
      this.ollamaInitPromise = (async () => {
        const dockerService = new (await import('./docker_service.js')).DockerService()
        const qdrantUrl = await dockerService.getServiceURL(SERVICE_NAMES.OLLAMA)
        if (!qdrantUrl) {
          throw new Error('Ollama service is not installed or running.')
        }
        this.ollama = new Ollama({ host: qdrantUrl })
      })()
    }
    return this.ollamaInitPromise
  }

  private async _ensureDependencies() {
    if (!this.ollama) {
      await this._initializeOllamaClient()
    }
  }

  /**
   * Downloads a model from the Ollama service with progress tracking. Where possible,
   * one should dispatch a background job instead of calling this method directly to avoid long blocking.
   * @param model Model name to download
   * @returns Success status and message
   */
  async downloadModel(model: string, progressCallback?: (percent: number) => void): Promise<{ success: boolean; message: string }> {
    try {
      await this._ensureDependencies()
      if (!this.ollama) {
        throw new Error('Ollama client is not initialized.')
      }

      // See if model is already installed
      const installedModels = await this.getModels()
      if (installedModels && installedModels.some((m) => m.name === model)) {
        logger.info(`[OllamaService] Model "${model}" is already installed.`)
        return { success: true, message: 'Model is already installed.' }
      }

      // Returns AbortableAsyncIterator<ProgressResponse>
      const downloadStream = await this.ollama.pull({
        model,
        stream: true,
      })

      for await (const chunk of downloadStream) {
        if (chunk.completed && chunk.total) {
          const percent = ((chunk.completed / chunk.total) * 100).toFixed(2)
          const percentNum = parseFloat(percent)

          this.broadcastDownloadProgress(model, percentNum)
          if (progressCallback) {
            progressCallback(percentNum)
          }
        }
      }

      logger.info(`[OllamaService] Model "${model}" downloaded successfully.`)
      return { success: true, message: 'Model downloaded successfully.' }
    } catch (error) {
      // Surface the real reason instead of swallowing it into a generic string.
      // On the oMLX backend the proxy streams an Ollama-style error frame (e.g.
      // "refusing to pull unmapped model 'X' (...)") which ollama-js rethrows as
      // the iterator's error — propagating it lets DownloadModelJob carry it into
      // the job's failedReason so the user/logs see WHY, not just "failed".
      const message =
        error instanceof Error && error.message ? error.message : 'Failed to download model.'
      logger.error(`[OllamaService] Failed to download model "${model}": ${message}`)
      return { success: false, message }
    }
  }

  async dispatchModelDownload(modelName: string): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`[OllamaService] Dispatching model download for ${modelName} via job queue`)

      await DownloadModelJob.dispatch({
        modelName,
      })

      return {
        success: true,
        message:
          'Model download has been queued successfully. It will start shortly after Ollama and Open WebUI are ready (if not already).',
      }
    } catch (error) {
      logger.error(
        `[OllamaService] Failed to dispatch model download for ${modelName}: ${error instanceof Error ? error.message : error}`
      )
      return {
        success: false,
        message: 'Failed to queue model download. Please try again.',
      }
    }
  }

  public async getClient() {
    await this._ensureDependencies()
    return this.ollama!
  }

  public async chat(chatRequest: ChatRequest & { stream?: boolean }) {
    await this._ensureDependencies()
    if (!this.ollama) {
      throw new Error('Ollama client is not initialized.')
    }
    return await this.ollama.chat({
      ...chatRequest,
      stream: false,
    })
  }

  public async chatStream(chatRequest: ChatRequest) {
    await this._ensureDependencies()
    if (!this.ollama) {
      throw new Error('Ollama client is not initialized.')
    }
    return await this.ollama.chat({
      ...chatRequest,
      stream: true,
    })
  }

  public async checkModelHasThinking(modelName: string): Promise<boolean> {
    await this._ensureDependencies()
    if (!this.ollama) {
      throw new Error('Ollama client is not initialized.')
    }

    const modelInfo = await this.ollama.show({
      model: modelName,
    })

    return modelInfo.capabilities.includes('thinking')
  }

  public async deleteModel(modelName: string) {
    await this._ensureDependencies()
    if (!this.ollama) {
      throw new Error('Ollama client is not initialized.')
    }

    return await this.ollama.delete({
      model: modelName,
    })
  }

  public async getModels(includeEmbeddings = false) {
    await this._ensureDependencies()
    if (!this.ollama) {
      throw new Error('Ollama client is not initialized.')
    }
    const response = await this.ollama.list()
    if (includeEmbeddings) {
      return response.models
    }
    // Filter out embedding models
    return response.models.filter((model) => !model.name.includes('embed'))
  }

  /**
   * Fetch the version of the native (host-managed) Ollama daemon via its
   * /api/version endpoint. The Apps page uses this on the 'ollama' backend to
   * show the real installed version (e.g. the brew-installed daemon) instead
   * of the seeder's hardcoded container-image tag, which is stale. Returns
   * null when OLLAMA_HOST is unset, Ollama is unreachable, or the response is
   * malformed — callers render a neutral placeholder rather than a misleading
   * version. Mirrors the /api/tags status probe in DockerService.
   *
   * Not meaningful on the 'omlx' backend (chat runs on Apple MLX and the proxy
   * on :11434 would answer for the embeddings sidecar, not the chat engine),
   * so callers must gate on the backend before invoking this.
   */
  public async getNativeServerVersion(): Promise<string | null> {
    const host = env.get('OLLAMA_HOST')
    if (!host) return null
    try {
      const response = await axios.get(`${host}/api/version`, { timeout: 3000 })
      const version = response.data?.version
      return typeof version === 'string' && version.trim() !== '' ? version.trim() : null
    } catch (error) {
      logger.warn(
        `[OllamaService] Failed to fetch native Ollama version: ${error instanceof Error ? error.message : error}`
      )
      return null
    }
  }

  /**
   * oMLX mode only: fetch the proxy's pullable set — the model_map.json keys it
   * can resolve to MLX — via GET <OLLAMA_HOST>/api/nomad/pullable. Used to
   * annotate the catalog with mlxPullName. Returns null when OLLAMA_HOST is
   * unset or the proxy is unreachable/malformed; callers then skip annotation
   * (the UI degrades to "all selectable" rather than hiding everything on a
   * transient blip). Mirrors the defensive null-return of getNativeServerVersion.
   */
  private async fetchMlxPullableKeys(): Promise<string[] | null> {
    const host = env.get('OLLAMA_HOST')
    if (!host) return null
    try {
      const response = await axios.get<{ models?: unknown }>(`${host}/api/nomad/pullable`, {
        timeout: 3000,
      })
      const models = response.data?.models
      return Array.isArray(models)
        ? models.filter((m): m is string => typeof m === 'string')
        : null
    } catch (error) {
      logger.warn(
        `[OllamaService] Failed to fetch MLX pullable set: ${error instanceof Error ? error.message : error}`
      )
      return null
    }
  }

  async getAvailableModels(
    { sort, recommendedOnly, query, limit, force }: { sort?: 'pulls' | 'name'; recommendedOnly?: boolean, query: string | null, limit?: number, force?: boolean } = {
      sort: 'pulls',
      recommendedOnly: false,
      query: null,
      limit: 15,
    }
  ): Promise<{ models: NomadOllamaModel[], hasMore: boolean } | null> {
    try {
      // oMLX mode: the catalog is the full Ollama library, but the proxy can
      // only pull the curated mlx-community conversions. Annotate each model
      // with the exact pullable key (mlxPullName) so the UI disables models with
      // no MLX build and sends a name the proxy resolves. Fetched once per call;
      // on the 'ollama' backend (or a transient proxy blip) this is null and
      // every model stays selectable, exactly as before this feature.
      const pullableKeys =
        env.get('NOMAD_AI_BACKEND') === 'omlx' ? await this.fetchMlxPullableKeys() : null

      let models = await this.retrieveAndRefreshModels(sort, force)
      if (!models) {
        // If we fail to get models from the API, return the fallback recommended models
        logger.warn(
          '[OllamaService] Returning fallback recommended models due to failure in fetching available models'
        )
        return {
          models: pullableKeys
            ? withMlxPullNames(FALLBACK_RECOMMENDED_OLLAMA_MODELS, pullableKeys)
            : FALLBACK_RECOMMENDED_OLLAMA_MODELS,
          hasMore: false
        }
      }

      // Carry mlxPullName through every downstream branch (full / query /
      // recommended) — the recommended path spreads each model object, so the
      // annotation survives the tag-trimming map below.
      if (pullableKeys) {
        models = withMlxPullNames(models, pullableKeys)
      }

      if (!recommendedOnly) {
        const filteredModels = query ? this.fuseSearchModels(models, query) : models
        return {
          models: filteredModels.slice(0, limit || 15),
          hasMore: filteredModels.length > (limit || 15)
        }
      }

      // If recommendedOnly is true, only return the first three models (if sorted by pulls, these will be the top 3)
      const sortedByPulls = sort === 'pulls' ? models : this.sortModels(models, 'pulls')
      const firstThree = sortedByPulls.slice(0, 3)

      // Only return the first tag of each of these models (should be the most lightweight variant)
      const recommendedModels = firstThree.map((model) => {
        return {
          ...model,
          tags: model.tags && model.tags.length > 0 ? [model.tags[0]] : [],
        }
      })

      if (query) {
        const filteredRecommendedModels = this.fuseSearchModels(recommendedModels, query)
        return {
          models: filteredRecommendedModels,
          hasMore: filteredRecommendedModels.length > (limit || 15)
        }
      }

      return {
        models: recommendedModels,
        hasMore: recommendedModels.length > (limit || 15)
      }
    } catch (error) {
      logger.error(
        `[OllamaService] Failed to get available models: ${error instanceof Error ? error.message : error}`
      )
      return null
    }
  }

  /**
   * Strip embedding models + apply description overrides. Applied AFTER any
   * source of model data (live API or cache) so the filtered view is
   * consistent regardless of whether the cache was populated by an older
   * code version that didn't filter.
   */
  private applyMacDistroFilters(models: NomadOllamaModel[]): NomadOllamaModel[] {
    const noEmbed = models.filter((m) => !m.name.toLowerCase().includes('embed'))
    return noEmbed.map((m) => {
      const override = MODEL_DESCRIPTION_OVERRIDES[m.name]
      return override ? { ...m, description: override } : m
    })
  }

  private async retrieveAndRefreshModels(
    sort?: 'pulls' | 'name',
    force?: boolean
  ): Promise<NomadOllamaModel[] | null> {
    try {
      if (!force) {
        const cachedModels = await this.readModelsFromCache()
        if (cachedModels) {
          logger.info('[OllamaService] Using cached available models data')
          // Apply Mac-distro filters even on cache hit — older cache files
          // may pre-date the filter, and we always want the user-facing
          // catalog to be filtered consistently.
          const filtered = this.applyMacDistroFilters(cachedModels)
          return this.sortModels(filtered, sort)
        }
      } else {
        logger.info('[OllamaService] Force refresh requested, bypassing cache')
      }

      logger.info('[OllamaService] Fetching fresh available models from API')

      const baseUrl = env.get('NOMAD_API_URL') || NOMAD_API_DEFAULT_BASE_URL
      const fullUrl = new URL(NOMAD_MODELS_API_PATH, baseUrl).toString()

      const response = await axios.get(fullUrl)
      if (!response.data || !Array.isArray(response.data.models)) {
        logger.warn(
          `[OllamaService] Invalid response format when fetching available models: ${JSON.stringify(response.data)}`
        )
        return null
      }

      const rawModels = response.data.models as NomadOllamaModel[]

      // Filter out tags where cloud is truthy, then remove models with no remaining tags
      const noCloud = rawModels
        .map((model) => ({
          ...model,
          tags: model.tags.filter((tag) => !tag.cloud),
        }))
        .filter((model) => model.tags.length > 0)

      // Apply the same Mac-distro filters (embed-strip + description
      // overrides) as the cache-read path so users see the same catalog
      // regardless of cache state.
      const filtered = this.applyMacDistroFilters(noCloud)

      await this.writeModelsToCache(filtered)
      return this.sortModels(filtered, sort)
    } catch (error) {
      logger.error(
        `[OllamaService] Failed to retrieve models from Nomad API: ${error instanceof Error ? error.message : error
        }`
      )
      return null
    }
  }

  private async readModelsFromCache(): Promise<NomadOllamaModel[] | null> {
    try {
      const stats = await fs.stat(MODELS_CACHE_FILE)
      const cacheAge = Date.now() - stats.mtimeMs

      if (cacheAge > CACHE_MAX_AGE_MS) {
        logger.info('[OllamaService] Cache is stale, will fetch fresh data')
        return null
      }

      const cacheData = await fs.readFile(MODELS_CACHE_FILE, 'utf-8')
      const models = JSON.parse(cacheData) as NomadOllamaModel[]

      if (!Array.isArray(models)) {
        logger.warn('[OllamaService] Invalid cache format, will fetch fresh data')
        return null
      }

      return models
    } catch (error) {
      // Cache doesn't exist or is invalid
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(
          `[OllamaService] Error reading cache: ${error instanceof Error ? error.message : error}`
        )
      }
      return null
    }
  }

  private async writeModelsToCache(models: NomadOllamaModel[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(MODELS_CACHE_FILE), { recursive: true })
      await fs.writeFile(MODELS_CACHE_FILE, JSON.stringify(models, null, 2), 'utf-8')
      logger.info('[OllamaService] Successfully cached available models')
    } catch (error) {
      logger.warn(
        `[OllamaService] Failed to write models cache: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  private sortModels(models: NomadOllamaModel[], sort?: 'pulls' | 'name'): NomadOllamaModel[] {
    if (sort === 'pulls') {
      // Sort by estimated pulls (it should be a string like "1.2K", "500", "4M" etc.)
      models.sort((a, b) => {
        const parsePulls = (pulls: string) => {
          const multiplier = pulls.endsWith('K')
            ? 1_000
            : pulls.endsWith('M')
              ? 1_000_000
              : pulls.endsWith('B')
                ? 1_000_000_000
                : 1
          return parseFloat(pulls) * multiplier
        }
        return parsePulls(b.estimated_pulls) - parsePulls(a.estimated_pulls)
      })
    } else if (sort === 'name') {
      models.sort((a, b) => a.name.localeCompare(b.name))
    }

    // Always sort model.tags by the size field in descending order
    // Size is a string like '75GB', '8.5GB', '2GB' etc. Smaller models first
    models.forEach((model) => {
      if (model.tags && Array.isArray(model.tags)) {
        model.tags.sort((a, b) => {
          const parseSize = (size: string) => {
            const multiplier = size.endsWith('KB')
              ? 1 / 1_000
              : size.endsWith('MB')
                ? 1 / 1_000_000
                : size.endsWith('GB')
                  ? 1
                  : size.endsWith('TB')
                    ? 1_000
                    : 0 // Unknown size format
            return parseFloat(size) * multiplier
          }
          return parseSize(a.size) - parseSize(b.size)
        })
      }
    })

    return models
  }

  private broadcastDownloadProgress(model: string, percent: number) {
    transmit.broadcast(BROADCAST_CHANNELS.OLLAMA_MODEL_DOWNLOAD, {
      model,
      percent,
      timestamp: new Date().toISOString(),
    })
    logger.info(`[OllamaService] Download progress for model "${model}": ${percent}%`)
  }

  private fuseSearchModels(models: NomadOllamaModel[], query: string): NomadOllamaModel[] {
    const options: IFuseOptions<NomadOllamaModel> = {
      ignoreDiacritics: true,
      keys: ['name', 'description', 'tags.name'],
      threshold: 0.3, // lower threshold for stricter matching
    }

    const fuse = new Fuse(models, options)

    return fuse.search(query).map(result => result.item)
  }
}
