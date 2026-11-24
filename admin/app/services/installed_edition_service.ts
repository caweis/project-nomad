import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { basename, join } from 'node:path'
import CollectionManifest from '#models/collection_manifest'
import InstalledResource from '#models/installed_resource'
import { buildPreviousIdMap, preferZimEdition } from '../utils/resource_aliases.js'
import { isSafeOldContentPath } from '../utils/content_path.js'
import { getFileStatsIfExists, ZIM_STORAGE_PATH } from '../utils/fs.js'

import type { ZimCategoriesSpec } from '../../types/collections.js'

type DownloadEdition = Pick<
  InstalledResource,
  'resource_id' | 'resource_type' | 'version' | 'url' | 'file_path'
> &
  Partial<Pick<InstalledResource, 'collection_ref'>>

export interface EditionSelection {
  resourceId: string
  aliases: Map<string, string>
  skipEmbedding: boolean
  previous: Pick<InstalledResource, 'version' | 'file_path'> | null
}

export async function lockedZimCatalog(
  trx: TransactionClientContract
): Promise<ZimCategoriesSpec | null> {
  // A refresh locks this row before rekeying the installs. Read both in the same order.
  const manifest = await CollectionManifest.query({ client: trx })
    .where('type', 'zim_categories')
    .forShare()
    .first()
  return manifest?.spec_data ?? null
}

/** Select the winning file under the installed row lock, including legacy jobs without metadata. */
export async function publishInstalledEdition(
  edition: DownloadEdition,
  options: {
    preferNewest?: boolean
    saveCheckpoint?: (selection: EditionSelection) => Promise<void>
  } = {}
) {
  let prepared: EditionSelection | undefined
  const readyToPublish = (selected: EditionSelection) =>
    !options.saveCheckpoint ||
    (prepared !== undefined &&
      prepared.resourceId === selected.resourceId &&
      prepared.skipEmbedding === selected.skipEmbedding &&
      prepared.previous?.file_path === selected.previous?.file_path &&
      prepared.previous?.version === selected.previous?.version &&
      prepared.aliases.size === selected.aliases.size &&
      [...selected.aliases].every(([former, current]) => prepared!.aliases.get(former) === current))

  for (let checkpoints = 0; ; checkpoints++) {
    const result = await tryPublishEdition(edition, options.preferNewest === true, readyToPublish)
    if (result.status !== 'checkpoint_needed') return result
    if (checkpoints >= 3) throw new Error('Installed edition changed repeatedly during completion')
    // Redis can be unavailable indefinitely. Release the SQL locks before writing the
    // checkpoint, then reselect the winner before publishing or touching either file.
    await options.saveCheckpoint!(result)
    prepared = result
  }
}

async function tryPublishEdition(
  edition: DownloadEdition,
  preferNewest: boolean,
  readyToPublish: (selection: EditionSelection) => boolean
) {
  return db.transaction(async (trx) => {
    const spec = edition.resource_type === 'zim' ? await lockedZimCatalog(trx) : null
    const aliases = buildPreviousIdMap(spec)
    const resourceId = aliases.get(edition.resource_id) ?? edition.resource_id
    const key = { resource_type: edition.resource_type, resource_id: resourceId }
    const current = await InstalledResource.query({ client: trx }).where(key).forUpdate().first()
    // Old queued payloads can predate the browse-only flag added to a renamed video.
    const skipEmbedding =
      resourceId !== edition.resource_id &&
      !!spec?.categories.some((category) =>
        category.tiers.some((tier) =>
          tier.resources.some((resource) => resource.id === resourceId && resource.skip_embedding)
        )
      )
    const selection: EditionSelection = {
      resourceId,
      aliases,
      skipEmbedding,
      previous: current
        ? {
            file_path: current.file_path,
            version: current.version,
          }
        : null,
    }
    if (
      current &&
      (preferNewest || [...aliases.values()].includes(resourceId)) &&
      current.file_path !== edition.file_path &&
      !preferZimEdition(
        resourceId,
        { name: basename(edition.file_path), version: edition.version },
        { name: basename(current.file_path), version: current.version }
      ) &&
      isSafeOldContentPath(
        current.file_path,
        resourceId,
        join(process.cwd(), ZIM_STORAGE_PATH),
        'zim',
        aliases
      ) &&
      (await getFileStatsIfExists(current.file_path))
    ) {
      return { ...selection, status: 'superseded' as const }
    }
    const stats = await getFileStatsIfExists(edition.file_path)
    if (!stats) return { ...selection, status: 'missing' as const }
    if (!readyToPublish(selection)) return { ...selection, status: 'checkpoint_needed' as const }

    const attributes = {
      ...edition,
      ...key,
      file_size_bytes: Number(stats.size),
      installed_at: DateTime.now(),
    }
    if (current) await current.merge(attributes).save()
    else await InstalledResource.create(attributes, { client: trx })
    return { ...selection, status: 'installed' as const }
  })
}
