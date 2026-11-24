import axios from 'axios'
import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { isSafeOldContentPath, parseDatedContentFilename } from '../utils/content_path.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { basename, join } from 'node:path'
import CollectionManifest from '#models/collection_manifest'
import InstalledResource from '#models/installed_resource'
import WikipediaSelection from '#models/wikipedia_selection'
import { zimCategoriesSpecSchema, mapsSpecSchema, wikipediaSpecSchema } from '#validators/curated_collections'
import { lockedZimCatalog, publishInstalledEdition } from './installed_edition_service.js'
import { buildPreviousIdMap, preferZimEdition } from '../utils/resource_aliases.js'
import { isManagedWikipediaFile } from '../utils/wikipedia_reconcile.js'
import { isGatedResource } from '../utils/hosted_content.js'
import {
  ensureDirectoryExists,
  listDirectoryContents,
  getFileStatsIfExists,
  ZIM_STORAGE_PATH,
} from '../utils/fs.js'
import type {
  ManifestType,
  ZimCategoriesSpec,
  MapsSpec,
  CategoryWithStatus,
  CollectionWithStatus,
  SpecResource,
  SpecTier,
} from '../../types/collections.js'

const SPEC_URLS: Record<ManifestType, string> = {
  zim_categories: 'https://raw.githubusercontent.com/caweis/project-nomad/refs/heads/main/collections/kiwix-categories.json',
  maps: 'https://github.com/caweis/project-nomad/raw/refs/heads/main/collections/maps.json',
  wikipedia: 'https://raw.githubusercontent.com/caweis/project-nomad/refs/heads/main/collections/wikipedia.json',
}

const VALIDATORS: Record<ManifestType, any> = {
  zim_categories: zimCategoriesSpecSchema,
  maps: mapsSpecSchema,
  wikipedia: wikipediaSpecSchema,
}

export class CollectionManifestService {
  private readonly mapStoragePath = '/storage/maps'

  // ---- Spec management ----

  async fetchAndCacheSpec(type: ManifestType): Promise<boolean> {
    try {
      const response = await axios.get(SPEC_URLS[type], { timeout: 15000 })

      const validated = await vine.validate({
        schema: VALIDATORS[type],
        data: response.data,
      })

      return await db.transaction(async (trx) => {
        // Publish the catalog with its install-row migrations, including refreshed
        // aliases on a spec version already cached by an older validator.
        const existing = await CollectionManifest.query({ client: trx })
          .where('type', type)
          .forUpdate()
          .first()
        const attributes = {
          spec_version: validated.spec_version,
          spec_data: validated,
          fetched_at: DateTime.now(),
        }
        const changed = existing?.spec_version !== attributes.spec_version
        if (existing) await existing.merge(attributes).save()
        else await CollectionManifest.create({ type, ...attributes }, { client: trx })
        if (type === 'zim_categories') {
          await this.migrateRenamedResources(
            buildPreviousIdMap(validated as ZimCategoriesSpec),
            trx
          )
        }
        return changed
      })
    } catch (error) {
      logger.error(`[CollectionManifestService] Failed to fetch spec for ${type}:`, error?.message || error)
      return false
    }
  }

  async getCachedSpec<T>(type: ManifestType): Promise<T | null> {
    const manifest = await CollectionManifest.find(type)
    if (!manifest) return null
    return manifest.spec_data as T
  }

  async getSpecWithFallback<T>(type: ManifestType): Promise<T | null> {
    try {
      await this.fetchAndCacheSpec(type)
    } catch {
      // Fetch failed, will fall back to cache
    }
    return this.getCachedSpec<T>(type)
  }

  // ---- Status computation ----

  async getCategoriesWithStatus(): Promise<CategoryWithStatus[]> {
    const spec = await this.getSpecWithFallback<ZimCategoriesSpec>('zim_categories')
    if (!spec) return []

    const installedResources = await InstalledResource.query().where('resource_type', 'zim')
    const installedMap = new Map(installedResources.map((r) => [r.resource_id, r]))

    return spec.categories.map((category) => ({
      ...category,
      installedTierSlug: this.getInstalledTierForCategory(category.tiers, installedMap),
    }))
  }

  async getMapCollectionsWithStatus(): Promise<CollectionWithStatus[]> {
    const spec = await this.getSpecWithFallback<MapsSpec>('maps')
    if (!spec) return []

    const installedResources = await InstalledResource.query().where('resource_type', 'map')
    const installedIds = new Set(installedResources.map((r) => r.resource_id))

    return spec.collections.map((collection) => {
      const installedCount = collection.resources.filter((r) => installedIds.has(r.id)).length
      return {
        ...collection,
        all_installed: installedCount === collection.resources.length,
        installed_count: installedCount,
        total_count: collection.resources.length,
      }
    })
  }

  /**
   * Resource ids in the ZIM manifest that are gated behind an entitlement key
   * (`auth: 'nomad_app_key'`, upstream #1172).
   *
   * Used to keep gated content out of the content-update-check path. Those
   * resources are not in the Nomad update API or the openzim catalog, so they
   * can never legitimately match there — but a resource-id collision would
   * otherwise let a third party present itself as a newer version and
   * overwrite gated content (with the auth header dropped, since update
   * downloads carry none). Their versions come from the manifest instead.
   *
   * Reads the CACHED spec rather than refetching: this sits on the update-check
   * path and does not need a network round-trip. A gated resource cannot be
   * installed without the manifest having been fetched first, so the cache is
   * always populated by the time it matters.
   *
   * Returns an empty set if the manifest has never been cached, which correctly
   * degrades to current behaviour rather than skipping every update.
   */
  async getGatedZimResourceIds(): Promise<Set<string>> {
    const ids = new Set<string>()
    const spec = await this.getCachedSpec<ZimCategoriesSpec>('zim_categories')
    if (!spec) return ids

    for (const category of spec.categories) {
      for (const tier of category.tiers) {
        for (const resource of tier.resources) {
          if (isGatedResource(resource)) ids.add(resource.id)
        }
      }
    }
    for (const [formerId, currentId] of buildPreviousIdMap(spec)) {
      if (ids.has(currentId)) ids.add(formerId)
    }
    return ids
  }

  // ---- Tier resolution ----

  static resolveTierResources(tier: SpecTier, allTiers: SpecTier[]): SpecResource[] {
    const visited = new Set<string>()
    return CollectionManifestService._resolveTierResourcesInner(tier, allTiers, visited)
  }

  private static _resolveTierResourcesInner(
    tier: SpecTier,
    allTiers: SpecTier[],
    visited: Set<string>
  ): SpecResource[] {
    if (visited.has(tier.slug)) return [] // cycle detection
    visited.add(tier.slug)

    const resources: SpecResource[] = []

    if (tier.includesTier) {
      const included = allTiers.find((t) => t.slug === tier.includesTier)
      if (included) {
        resources.push(...CollectionManifestService._resolveTierResourcesInner(included, allTiers, visited))
      }
    }

    resources.push(...tier.resources)
    return resources
  }

  getInstalledTierForCategory(
    tiers: SpecTier[],
    installedMap: Map<string, InstalledResource>
  ): string | undefined {
    // Check from highest tier to lowest (tiers are ordered low to high in spec)
    const reversedTiers = [...tiers].reverse()

    for (const tier of reversedTiers) {
      const resolved = CollectionManifestService.resolveTierResources(tier, tiers)
      if (resolved.length === 0) continue

      const allInstalled = resolved.every((r) => installedMap.has(r.id))
      if (allInstalled) {
        return tier.slug
      }
    }

    return undefined
  }

  // ---- Filename parsing ----

  static parseZimFilename(filename: string): { resource_id: string; version: string } | null {
    return parseDatedContentFilename(
      filename.endsWith('.zim') ? filename : filename + '.zim',
      'zim'
    )
  }

  static parseMapFilename(filename: string): { resource_id: string; version: string } | null {
    const name = filename.replace(/\.pmtiles$/, '')
    const match = name.match(/^(.+)_(\d{4}-\d{2})$/)
    if (!match) return null
    return { resource_id: match[1], version: match[2] }
  }

  /** Preserve the installed row and its update policy when a manifest renames a book. */
  private async migrateRenamedResources(
    aliases: Map<string, string>,
    trx: TransactionClientContract
  ): Promise<void> {
    if (!aliases.size) return
    const rows = await InstalledResource.query({ client: trx })
      .where('resource_type', 'zim')
      .whereIn('resource_id', [...new Set([...aliases.keys(), ...aliases.values()])])
      .orderBy('resource_id')
      .forUpdate()
    const installedIds = new Set(rows.map((row) => row.resource_id))
    for (const row of rows) {
      const currentId = aliases.get(row.resource_id)
      // If both exist, keep the canonical row. Reconcile will choose the
      // newest file actually on disk before retiring the duplicate record.
      if (!currentId || installedIds.has(currentId)) continue
      row.resource_id = currentId
      await row.save()
      installedIds.add(currentId)
    }
  }

  // ---- Filesystem reconciliation ----

  async reconcileFromFilesystem(): Promise<{ zim: number; map: number }> {
    let zimCount = 0
    let mapCount = 0

    console.log("RECONCILING FILESYSTEM MANIFESTS...")

    // Reconcile ZIM files
    try {
      const zimDir = join(process.cwd(), ZIM_STORAGE_PATH)
      await ensureDirectoryExists(zimDir)
      // Only rows present before enumeration are eligible for removal in this scan.
      const { zimSpec, aliases, installedBeforeScan } = await db.transaction(async (trx) => {
        const spec = await lockedZimCatalog(trx)
        const aliasMap = buildPreviousIdMap(spec)
        await this.migrateRenamedResources(aliasMap, trx)
        const rows = await InstalledResource.query({ client: trx }).where('resource_type', 'zim')
        return { zimSpec: spec, aliases: aliasMap, installedBeforeScan: rows }
      })
      const zimItems = await listDirectoryContents(zimDir)
      const zimFiles = zimItems.filter((f) => f.type === 'file' && f.name.endsWith('.zim'))

      console.log(`Found ${zimFiles.length} ZIM files on disk. Reconciling with database...`)

      const specResourceMap = new Map<string, SpecResource>()
      if (zimSpec) {
        for (const cat of zimSpec.categories) {
          for (const tier of cat.tiers) {
            for (const res of tier.resources) {
              specResourceMap.set(res.id, res)
            }
          }
        }
      }

      const newest = new Map<string, { name: string; version: string; resource_id: string }>()

      // Only skip the single general-Wikipedia file tracked by WikipediaSelection,
      // not every file starting with `wikipedia_en_`. Curated category tiers ship
      // Wikipedia-themed ZIMs (e.g. wikipedia_en_medicine_maxi) that must reconcile
      // normally — otherwise their InstalledResource row is wiped on every restart
      // and the detected tier silently downgrades.
      const wikipediaSelection = await WikipediaSelection.query().first()
      const managedWikipediaFilename = wikipediaSelection?.filename ?? null

      for (const file of zimFiles) {
        console.log('Processing ZIM file')
        if (isManagedWikipediaFile(file.name, managedWikipediaFilename)) continue

        const parsed = CollectionManifestService.parseZimFilename(file.name)
        console.log(`Parsed ZIM filename: ${parsed ? 'recognized' : 'unrecognized'}`)
        if (!parsed) continue

        const id = aliases.get(parsed.resource_id) ?? parsed.resource_id
        const prior = newest.get(id)
        const candidate = { name: file.name, ...parsed }
        if (!prior || preferZimEdition(id, candidate, prior)) newest.set(id, candidate)
      }

      const seen = new Set<string>()
      for (const [resourceId, file] of newest) {
        const publication = await publishInstalledEdition(
          {
            resource_id: file.resource_id,
            resource_type: 'zim',
            version: file.version,
            url: specResourceMap.get(resourceId)?.url || '',
            file_path: join(zimDir, file.name),
          },
          { preferNewest: true }
        )
        if (publication.status === 'missing') continue
        seen.add(publication.resourceId)
        zimCount++
      }

      for (const entry of installedBeforeScan) {
        if (seen.has(entry.resource_id)) continue
        await db.transaction(async (trx) => {
          const row = await InstalledResource.query({ client: trx })
            .where({
              id: entry.id,
              resource_id: entry.resource_id,
              version: entry.version,
              file_path: entry.file_path,
            })
            .forUpdate()
            .first()
          if (!row) return
          // A worker can redownload the very same path after our directory snapshot.
          // Former-ID duplicates and separately managed Wikipedia rows still retire.
          if (
            !aliases.has(row.resource_id) &&
            !isManagedWikipediaFile(basename(row.file_path), managedWikipediaFilename) &&
            isSafeOldContentPath(row.file_path, row.resource_id, zimDir, 'zim', aliases) &&
            (await getFileStatsIfExists(row.file_path))
          )
            return
          await row.delete()
        })
      }
    } catch (error) {
      logger.error('[CollectionManifestService] Error reconciling ZIM files:', error)
    }

    // Reconcile map files
    try {
      const mapDir = join(process.cwd(), this.mapStoragePath, 'pmtiles')
      await ensureDirectoryExists(mapDir)
      const mapItems = await listDirectoryContents(mapDir)
      const mapFiles = mapItems.filter((f) => f.name.endsWith('.pmtiles'))

      // Get spec for URL/version lookup
      const mapSpec = await this.getCachedSpec<MapsSpec>('maps')
      const mapResourceMap = new Map<string, SpecResource>()
      if (mapSpec) {
        for (const col of mapSpec.collections) {
          for (const res of col.resources) {
            mapResourceMap.set(res.id, res)
          }
        }
      }

      const seenMapIds = new Set<string>()

      for (const file of mapFiles) {
        const parsed = CollectionManifestService.parseMapFilename(file.name)
        if (!parsed) continue

        seenMapIds.add(parsed.resource_id)

        const specRes = mapResourceMap.get(parsed.resource_id)
        const filePath = join(mapDir, file.name)
        const stats = await getFileStatsIfExists(filePath)

        await InstalledResource.updateOrCreate(
          { resource_id: parsed.resource_id, resource_type: 'map' },
          {
            version: parsed.version,
            url: specRes?.url || '',
            file_path: filePath,
            file_size_bytes: stats ? Number(stats.size) : null,
            installed_at: DateTime.now(),
          }
        )
        mapCount++
      }

      // Remove entries for map files no longer on disk
      const existingMaps = await InstalledResource.query().where('resource_type', 'map')
      for (const entry of existingMaps) {
        if (!seenMapIds.has(entry.resource_id)) {
          await entry.delete()
        }
      }
    } catch (error) {
      logger.error('[CollectionManifestService] Error reconciling map files:', error)
    }

    logger.info(`[CollectionManifestService] Reconciled ${zimCount} ZIM files, ${mapCount} map files`)
    return { zim: zimCount, map: mapCount }
  }
}
