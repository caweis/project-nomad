import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import axios from 'axios'
import { DateTime } from 'luxon'
import { mock } from 'node:test'
import { EventEmitter } from 'node:events'
import QueueWork from '../../commands/queue/work.js'
import { syncBuiltinESMExports } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import fsPromises, { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import InstalledResource from '#models/installed_resource'
import CollectionManifest from '#models/collection_manifest'
import { CollectionManifestService } from '#services/collection_manifest_service'
import { DockerService } from '#services/docker_service'
import { KiwixLibraryService } from '#services/kiwix_library_service'
import { QueueService } from '#services/queue_service'
import { ZimService } from '#services/zim_service'
import KVStore from '#models/kv_store'
import { EmbedFileJob } from '#jobs/embed_file_job'
import { RunDownloadJob } from '#jobs/run_download_job'
import type { RunDownloadJobParams } from '../../types/downloads.js'
import Installed from '../../database/migrations/1770849119787_create_create_installed_resources_table.js'
import Updates from '../../database/migrations/1778700000007_add_content_auto_update_fields_to_installed_resources.js'
import Manifests from '../../database/migrations/1770849108030_create_create_collection_manifests_table.js'
import Wikipedia from '../../database/migrations/1769500000001_create_wikipedia_selection_table.js'

const oldId = 'fas-military-medicine_en'
const currentId = 'irp.fas.org_en_military-medicine'
const earlier = '2025-06'
const latest = '2026-10'
const service = new CollectionManifestService()
const pathFor = (id: string, version: string) =>
  join(process.cwd(), 'storage/zim', id + '_' + version + '.zim')

function catalog(
  ids: { id: string; previous_ids: string[]; skip_embedding?: boolean }[] = [
    { id: currentId, previous_ids: [oldId] },
  ]
) {
  const resources = ids.map((resource) => ({
    ...resource,
    version: latest,
    title: resource.id,
    description: 'Test edition',
    size_mb: 1,
    url: 'https://example.org/' + resource.id + '_' + latest + '.zim',
  }))
  return {
    spec_version: '1',
    categories: [
      {
        name: 'Medicine',
        slug: 'medicine',
        icon: 'icon',
        description: 'Books',
        language: 'en',
        tiers: [{ name: 'Core', slug: 'core', description: 'Books', resources }],
      },
    ],
  }
}

async function cache(spec = catalog()) {
  await CollectionManifest.create({
    type: 'zim_categories',
    spec_version: spec.spec_version,
    spec_data: spec,
    fetched_at: DateTime.now(),
  })
}

async function install(id: string, version: string, filePath = pathFor(id, version)) {
  await writeFile(filePath, 'keep')
  return InstalledResource.create({
    resource_id: id,
    resource_type: 'zim',
    version,
    file_path: filePath,
    url: 'https://example.org/prior',
    installed_at: DateTime.now(),
    collection_ref: 'medicine',
    auto_update_disabled_reason: 'operator hold',
  })
}

async function finishDownload(
  id: string,
  version: string,
  options: {
    oldSnapshot?: string
    urlFilename?: string
    removePublishedFile?: boolean
    skipEmbedding?: boolean
    savedEmbedDecision?: boolean
    withoutMetadata?: boolean
    attemptsMade?: number
    saveCheckpoint?: (
      context: NonNullable<RunDownloadJobParams['completionContext']>
    ) => Promise<void>
  } = {}
) {
  const filepath = pathFor(id, version)
  const url = 'https://example.org/' + (options.urlFilename ?? basename(filepath))
  const job = {
    attemptsMade: options.attemptsMade ?? (options.oldSnapshot ? 1 : 0),
    data: {
      url,
      filepath,
      filetype: 'zim',
      timeout: 1000,
      allowedMimeTypes: ['application/x-zim'],
      resourceMetadata: options.withoutMetadata
        ? undefined
        : {
            resource_id: id,
            version,
            collection_ref: 'medicine',
            skip_embedding: options.skipEmbedding,
          },
      ...((options.oldSnapshot || options.savedEmbedDecision) && {
        completionContext: {
          oldFilePath: options.oldSnapshot ?? null,
          oldFileWasIndexed: false,
          ingestDecision: options.savedEmbedDecision ? 'embed' : 'skip',
        },
      }),
    } as RunDownloadJobParams,
    updateData: async (data: RunDownloadJobParams) => {
      if (data.completionContext && !data.completionDone)
        await options.saveCheckpoint?.(data.completionContext)
      job.data = data
      if (options.removePublishedFile && !data.completionDone) await rm(filepath)
    },
    updateProgress: async () => {},
  }
  await new RunDownloadJob().handle(job as any)
  return job.data
}

test.group('curated ZIM renames', (group) => {
  group.each.setup(async () => {
    const primary = db.primaryConnectionName
    const cwd = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), 'nomad-alias-'))
    const adapter = axios.defaults.adapter
    const name = 'collection_alias_test'
    db.manager.add(name, {
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    })
    db.primaryConnectionName = name
    try {
      const client = db.connection()
      for (const Migration of [Installed, Updates, Manifests, Wikipedia]) {
        await new Migration(client, Migration.name).execUp()
      }
      process.chdir(directory)
      await mkdir(join(directory, 'storage/zim'), { recursive: true })
      axios.defaults.adapter = async (config) => ({
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'content-length': '4', 'content-type': 'application/x-zim' },
        data: config.url?.endsWith('.json')
          ? config.url.endsWith('wikipedia.json')
            ? {
                spec_version: '1',
                options: [
                  {
                    id: 'none',
                    name: 'None',
                    description: 'No Wikipedia',
                    url: null,
                    version: null,
                    size_mb: 0,
                  },
                ],
              }
            : catalog()
          : config.method === 'head'
            ? ''
            : Readable.from([Buffer.from('done')]),
      })
      mock.method(DockerService.prototype, 'getServiceURL', async () => null)
      mock.method(DockerService.prototype, 'isKiwixOnLegacyConfig', async () => false)
      mock.method(KiwixLibraryService.prototype, 'rebuildFromDisk', async () => {})
      mock.method(QueueService.getInstance(), 'getQueue', () => ({
        getActive: async () => [],
        getWaiting: async () => [],
      }))
    } catch (error) {
      await cleanup()
      throw error
    }
    async function cleanup() {
      mock.restoreAll()
      axios.defaults.adapter = adapter
      process.chdir(cwd)
      db.primaryConnectionName = primary
      await db.manager.close(name, true)
      await rm(directory, { recursive: true, force: true })
    }
    return cleanup
  })

  test('refresh migrates a legacy row in place even when the cached version is unchanged', async ({
    assert,
  }) => {
    const legacy = await install(oldId, earlier)
    await cache(catalog([{ id: currentId, previous_ids: [] }]))
    assert.isFalse(await service.fetchAndCacheSpec('zim_categories'))
    const current = await InstalledResource.findByOrFail('resource_id', currentId)
    assert.equal(current.id, legacy.id)
    assert.equal(current.file_path, legacy.file_path)
    assert.equal(current.collection_ref, 'medicine')
    assert.equal(current.auto_update_disabled_reason, 'operator hold')
    const categories = await service.getCategoriesWithStatus()
    assert.equal(categories[0].installedTierSlug, 'core')
    assert.isNull(
      await new ZimService({} as DockerService).downloadCategoryTier('medicine', 'core')
    )
    assert.lengthOf(await InstalledResource.all(), 1)
  })

  test('terminal auto-update failures on a retired ID count against the migrated ZIM', async ({
    assert,
  }) => {
    const legacy = await install(oldId, earlier)
    legacy.auto_update_consecutive_failures = 2
    legacy.auto_update_disabled_reason = null
    await legacy.save()
    const separateMap = await InstalledResource.create({
      resource_id: oldId,
      resource_type: 'map',
      file_path: '/map.pmtiles',
      version: earlier,
      url: 'https://example.org/map.pmtiles',
      installed_at: DateTime.now(),
    })
    const other = await install('different-book', earlier)
    await service.fetchAndCacheSpec('zim_categories')
    await legacy.refresh()
    assert.equal(legacy.resource_id, currentId)

    const worker = new EventEmitter()
    const command = Object.create(QueueWork.prototype)
    Object.defineProperty(command, 'logger', { value: { error: () => {} } })
    command.registerFailureHandler(worker, RunDownloadJob.queue)
    const [onFailed] = worker.listeners('failed')
    const job = {
      name: RunDownloadJob.key,
      data: {
        filetype: 'zim',
        url: 'https://example.org/previous.zim',
        resourceMetadata: { resource_id: oldId, auto: true },
      },
      finishedOn: 100,
    }
    const failure = new Error('download failed')
    await onFailed({ ...job, finishedOn: undefined }, failure)
    await onFailed(job, new Error('Download cancelled: by user'))
    await onFailed(
      { ...job, data: { ...job.data, resourceMetadata: { resource_id: oldId, auto: false } } },
      failure
    )
    await legacy.refresh()
    assert.equal(legacy.auto_update_consecutive_failures, 2)
    assert.isNull(legacy.auto_update_disabled_reason)

    await onFailed(job, failure)
    await legacy.refresh()
    assert.equal(legacy.auto_update_consecutive_failures, 3)
    assert.include(legacy.auto_update_disabled_reason ?? '', 'disabled after 3')
    await separateMap.refresh()
    assert.equal(separateMap.auto_update_consecutive_failures, 0)

    await onFailed({ ...job, data: { ...job.data, filetype: 'map' } }, failure)
    await separateMap.refresh()
    assert.equal(separateMap.auto_update_consecutive_failures, 1)
    await onFailed(
      {
        ...job,
        data: { ...job.data, resourceMetadata: { resource_id: other.resource_id, auto: true } },
      },
      failure
    )
    await other.refresh()
    assert.equal(other.auto_update_consecutive_failures, 1)
    await legacy.refresh()
    assert.equal(legacy.auto_update_consecutive_failures, 3)
  })

  test('a failed ID migration rolls back the published manifest and preserves operator state', async ({
    assert,
  }) => {
    const oldSpec = catalog([{ id: oldId, previous_ids: [] }])
    await cache(oldSpec)
    const legacy = await install(oldId, earlier)
    await db.rawQuery(
      "CREATE TRIGGER stop_rename BEFORE UPDATE OF resource_id ON installed_resources BEGIN SELECT RAISE(ABORT, 'test rename failure'); END"
    )
    assert.isFalse(await service.fetchAndCacheSpec('zim_categories'))
    const manifest = await CollectionManifest.findOrFail('zim_categories')
    assert.deepEqual(manifest.spec_data, oldSpec)
    await legacy.refresh()
    assert.equal(legacy.resource_id, oldId)
    assert.equal(legacy.auto_update_disabled_reason, 'operator hold')
    assert.isNull(await InstalledResource.findBy('resource_id', currentId))
  })

  test('a slower legacy completion cannot republish an edition deleted by the newer download', async ({
    assert,
  }) => {
    await cache()
    const installed = await install(currentId, earlier, pathFor(oldId, earlier))
    const selected = Promise.withResolvers<boolean>()
    const resume = Promise.withResolvers<void>()
    const original = InstalledResource.query.bind(InstalledResource)
    let pauseNextRead = true
    mock.method(InstalledResource, 'query', (options?: Parameters<typeof original>[0]) => {
      const query = original(options)
      if (pauseNextRead) {
        pauseNextRead = false
        const first = query.first.bind(query)
        mock.method(query, 'first', async () => {
          const row = await first()
          selected.resolve(options?.client?.isTransaction === true)
          await resume.promise
          return row
        })
      }
      return query
    })

    const legacy = new ZimService(new DockerService()).downloadRemoteSuccessCallback(
      ['https://example.org/' + basename(installed.file_path)],
      false
    )
    const locked = await selected.promise
    const newer = finishDownload(currentId, latest)
    try {
      // At an unlocked read the newer write can finish before the older callback resumes.
      // A locked read must finish first to release SQLite's sole write connection.
      if (!locked) await newer
    } finally {
      resume.resolve()
    }
    await Promise.all([legacy, newer])
    await installed.refresh()
    assert.equal(installed.file_path, pathFor(currentId, latest))
    assert.equal(await readFile(installed.file_path, 'utf8'), 'done')
    assert.notInclude(await readdir('storage/zim'), basename(pathFor(oldId, earlier)))
    assert.isTrue(locked)
  })

  test('offline boot keeps an old filename, its canonical row, and update preferences', async ({
    assert,
  }) => {
    await cache()
    const legacy = await install(oldId, earlier)
    await service.reconcileFromFilesystem()
    const rows = await InstalledResource.all()
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].resource_id, currentId)
    assert.equal(rows[0].id, legacy.id)
    assert.equal(rows[0].file_path, legacy.file_path)
    assert.equal(rows[0].auto_update_disabled_reason, 'operator hold')
    assert.equal(rows[0].url, catalog().categories[0].tiers[0].resources[0].url)
    assert.equal(await readFile(legacy.file_path, 'utf8'), 'keep')
  })

  for (const version of ['2025', '2025-06-17']) {
    test('boot preserves a tracked former filename with edition ' + version, async ({ assert }) => {
      await cache()
      const existing = await install(oldId, version)
      await service.reconcileFromFilesystem()
      const current = await InstalledResource.findOrFail(existing.id)
      assert.equal(current.resource_id, currentId)
      assert.equal(current.version, version)
      assert.equal(current.file_path, existing.file_path)
      assert.equal(current.auto_update_disabled_reason, 'operator hold')
    })
  }

  for (const oldVersion of [earlier, latest, '2026-11']) {
    test(
      'reconciles duplicate rows and files with former edition ' + oldVersion,
      async ({ assert }) => {
        const legacy = await install(oldId, oldVersion)
        const current = await install(currentId, latest)
        await service.fetchAndCacheSpec('zim_categories')
        const recorded = await InstalledResource.findOrFail(current.id)
        assert.equal(recorded.file_path, current.file_path)
        await service.reconcileFromFilesystem()
        const rows = await InstalledResource.all()
        assert.lengthOf(rows, 1)
        assert.equal(rows[0].id, current.id)
        assert.equal(rows[0].resource_id, currentId)
        assert.equal(rows[0].file_path, oldVersion > latest ? legacy.file_path : current.file_path)
        assert.equal(await readFile(legacy.file_path, 'utf8'), 'keep')
        assert.equal(await readFile(current.file_path, 'utf8'), 'keep')
      }
    )
  }

  test('two different books cannot claim a shared former ID or an active current ID', async ({
    assert,
  }) => {
    await cache(
      catalog([
        { id: 'first', previous_ids: ['shared', 'live'] },
        { id: 'second', previous_ids: ['shared'] },
        { id: 'live', previous_ids: [] },
      ])
    )
    const shared = await install('shared', earlier)
    const live = await install('live', earlier)
    await service.reconcileFromFilesystem()
    await shared.refresh()
    await live.refresh()
    assert.equal(shared.resource_id, 'shared')
    assert.equal(live.resource_id, 'live')
    assert.lengthOf(await InstalledResource.all(), 2)
  })

  test('deleting a tracked former filename removes its current install row', async ({ assert }) => {
    const installed = await install(currentId, earlier, pathFor(oldId, earlier))
    await new ZimService(new DockerService()).delete(basename(installed.file_path))
    assert.isNull(await InstalledResource.find(installed.id))
  })

  test('deleting an orphan edition preserves the row tracking a different edition', async ({
    assert,
  }) => {
    const current = await install(currentId, latest)
    const orphan = pathFor(currentId, earlier)
    await writeFile(orphan, 'orphan')
    await new ZimService(new DockerService()).delete(basename(orphan))
    const recorded = await InstalledResource.findOrFail(current.id)
    assert.equal(recorded.file_path, current.file_path)
  })

  test('download completion replaces the tracked former filename, updates the current row and keeps nearby books', async ({
    assert,
  }) => {
    await cache()
    const installed = await install(currentId, earlier, pathFor(oldId, earlier))
    const other = pathFor(oldId + '_maxi', earlier)
    await writeFile(other, 'keep')
    const data = await finishDownload(currentId, latest, {
      urlFilename: basename(pathFor(oldId, latest)),
    })
    assert.equal(data.completionContext?.oldFilePath, installed.file_path)
    await installed.refresh()
    assert.equal(installed.file_path, pathFor(currentId, latest))
    assert.lengthOf(await InstalledResource.all(), 1)
    const files = await readdir('storage/zim')
    assert.deepEqual(files.sort(), [basename(other), basename(pathFor(currentId, latest))].sort())
    assert.equal(await readFile(other, 'utf8'), 'keep')
  })

  for (const replay of [false, true]) {
    test(
      'protects a longer book ID during ' + (replay ? 'resumed' : 'fresh') + ' completion',
      async ({ assert }) => {
        await cache()
        const other = pathFor(currentId + '_maxi', earlier)
        await install(currentId, earlier, other)
        await finishDownload(currentId, latest, replay ? { oldSnapshot: other } : {})
        assert.equal(await readFile(other, 'utf8'), 'keep')
        assert.equal(await readFile(pathFor(currentId, latest), 'utf8'), 'done')
      }
    )
  }

  test('a delayed completion cleans the edition published since its saved snapshot', async ({
    assert,
  }) => {
    await cache()
    const first = await install(currentId, earlier, pathFor(oldId, earlier))
    await finishDownload(currentId, '2026-09')
    const result = await finishDownload(currentId, latest, { oldSnapshot: first.file_path })
    assert.equal(result.completionContext?.oldFilePath, pathFor(currentId, '2026-09'))
    assert.deepEqual(await readdir('storage/zim'), [basename(pathFor(currentId, latest))])
  })

  test('catalog refresh can change browse-only policy while Redis saves a completion checkpoint', async ({
    assert,
  }) => {
    const previous = 'canadian_prepper_bugoutroll_en'
    const current = 'canadian-prepper_en_bugoutroll'
    await cache(catalog([{ id: current, previous_ids: [previous] }]))
    mock.method(DockerService.prototype, 'getServiceURL', async () => 'http://qdrant.test:6333')
    mock.method(KVStore, 'getValue', async () => 'Always')
    const embed = mock.method(EmbedFileJob, 'dispatch', async () => {})
    const started = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const decisions: string[] = []
    const download = finishDownload(previous, latest, {
      async saveCheckpoint(context) {
        decisions.push(context.ingestDecision)
        if (decisions.length === 1) {
          started.resolve()
          await resume.promise
        }
      },
    })
    await started.promise
    const response = mock.method(axios, 'get', async () => ({
      data: catalog([{ id: current, previous_ids: [previous], skip_embedding: true }]),
    }))
    const refresh = service.fetchAndCacheSpec('zim_categories')
    let progressed: boolean
    try {
      progressed = await Promise.race([refresh.then(() => true), delay(400, false)])
    } finally {
      resume.resolve()
      await Promise.all([download, refresh])
      response.mock.restore()
    }
    assert.isTrue(progressed)
    assert.deepEqual(decisions, ['embed', 'skip'])
    assert.equal(embed.mock.callCount(), 0)
  })

  for (const intervening of ['2026-09', '2026-11']) {
    test(
      'revalidates a paused queue checkpoint after ' + intervening + ' installs',
      async ({ assert }) => {
        await cache()
        const installed = await install(currentId, earlier, pathFor(oldId, earlier))
        const original = installed.file_path
        const started = Promise.withResolvers<void>()
        const resume = Promise.withResolvers<void>()
        const saved: Array<string | null> = []
        const download = finishDownload(currentId, latest, {
          async saveCheckpoint(context) {
            saved.push(context.oldFilePath)
            if (saved.length === 1) {
              started.resolve()
              await resume.promise
            }
          },
        })
        await started.promise
        const update = finishDownload(currentId, intervening)
        let progressed: boolean
        try {
          progressed = await Promise.race([update.then(() => true), delay(400, false)])
        } finally {
          resume.resolve()
          await Promise.all([update, download])
        }
        assert.isTrue(progressed)
        await installed.refresh()
        const winner = intervening > latest ? intervening : latest
        assert.equal(installed.file_path, pathFor(currentId, winner))
        assert.equal(await readFile(installed.file_path, 'utf8'), 'done')
        assert.deepEqual(
          saved,
          intervening > latest ? [original] : [original, pathFor(currentId, intervening)]
        )
        if (intervening < latest)
          assert.notInclude(await readdir('storage/zim'), basename(pathFor(currentId, intervening)))
      }
    )
  }

  test('a rejected queue checkpoint leaves the prior install available to a retry', async ({
    assert,
  }) => {
    await cache()
    const installed = await install(currentId, earlier, pathFor(oldId, earlier))
    const original = installed.file_path
    await assert.rejects(
      () =>
        finishDownload(currentId, latest, {
          async saveCheckpoint() {
            throw new Error('Redis unavailable')
          },
        }),
      /Redis unavailable/
    )
    await installed.refresh()
    assert.equal(installed.file_path, original)
    assert.equal(await readFile(original, 'utf8'), 'keep')
    const retried = await finishDownload(currentId, latest, { attemptsMade: 1 })
    assert.equal(retried.completionContext?.oldFilePath, original)
    assert.deepEqual(await readdir('storage/zim'), [basename(pathFor(currentId, latest))])
  })

  test('a persisted cleanup path cannot remove a newer file of the same book', async ({
    assert,
  }) => {
    await cache()
    await install(currentId, earlier, pathFor(oldId, earlier))
    const future = pathFor(oldId, '2026-12')
    await writeFile(future, 'keep')
    await finishDownload(currentId, latest, { oldSnapshot: future })
    assert.equal(await readFile(future, 'utf8'), 'keep')
  })

  test('a disappeared destination leaves the installed row and former file intact', async ({
    assert,
  }) => {
    await cache()
    const current = await install(currentId, earlier, pathFor(oldId, earlier))
    await assert.rejects(
      () => finishDownload(currentId, latest, { removePublishedFile: true }),
      /disappeared/
    )
    const recorded = await InstalledResource.findOrFail(current.id)
    assert.equal(recorded.file_path, current.file_path)
    assert.equal(await readFile(current.file_path, 'utf8'), 'keep')
  })

  test('an older job without metadata records its actual former file and protects a different book', async ({
    assert,
  }) => {
    await cache()
    const sibling = pathFor(currentId + '_maxi', earlier)
    await install(currentId, earlier, sibling)
    const downloaded = pathFor(oldId, latest)
    await writeFile(downloaded, 'done')
    await new ZimService(new DockerService()).downloadRemoteSuccessCallback(
      ['https://example.org/' + basename(downloaded)],
      false
    )
    const rows = await InstalledResource.all()
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].resource_id, currentId)
    assert.equal(rows[0].file_path, downloaded)
    assert.equal(await readFile(sibling, 'utf8'), 'keep')
  })

  test('a download queued under a former ID does not recreate its retired row', async ({
    assert,
  }) => {
    await cache()
    await finishDownload(oldId, earlier)
    const rows = await InstalledResource.all()
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].resource_id, currentId)
    assert.equal(rows[0].file_path, pathFor(oldId, earlier))
  })

  for (const source of ['catalog', 'queued job', 'old snapshot']) {
    test('a former-ID download respects browse-only policy from ' + source, async ({ assert }) => {
      const former = 'canadian_prepper_bugoutroll_en'
      const current = 'canadian-prepper_en_bugoutroll'
      await cache(
        catalog([{ id: current, previous_ids: [former], skip_embedding: source !== 'queued job' }])
      )
      mock.method(DockerService.prototype, 'getServiceURL', async () => 'http://qdrant.test:6333')
      mock.method(KVStore, 'getValue', async () => 'Always')
      const embed = mock.method(EmbedFileJob, 'dispatch', async () => {})
      const data = await finishDownload(former, earlier, {
        skipEmbedding: source === 'queued job' ? true : undefined,
        savedEmbedDecision: source === 'old snapshot',
      })
      assert.equal(data.completionContext?.ingestDecision, 'skip')
      assert.equal(embed.mock.callCount(), 0)
      const recorded = await InstalledResource.findByOrFail('resource_id', current)
      assert.equal(recorded.file_path, pathFor(former, earlier))
    })
  }

  test('a late older alias download preserves the tracked newer edition', async ({ assert }) => {
    await cache()
    const current = await install(currentId, latest)
    await finishDownload(oldId, earlier)
    const rows = await InstalledResource.all()
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].id, current.id)
    assert.equal(rows[0].file_path, current.file_path)
    assert.equal(await readFile(current.file_path, 'utf8'), 'keep')
  })

  for (const scenario of ['browse-only', 'superseded']) {
    test(
      'a download without metadata skips embedding a ' + scenario + ' edition',
      async ({ assert }) => {
        const previous = scenario === 'browse-only' ? 'canadian_prepper_bugoutroll_en' : oldId
        const current = scenario === 'browse-only' ? 'canadian-prepper_en_bugoutroll' : currentId
        await cache(
          catalog([
            { id: current, previous_ids: [previous], skip_embedding: scenario === 'browse-only' },
          ])
        )
        if (scenario === 'superseded') await install(current, latest)
        mock.method(DockerService.prototype, 'getServiceURL', async () => 'http://qdrant.test:6333')
        mock.method(KVStore, 'getValue', async () => 'Always')
        const embed = mock.method(EmbedFileJob, 'dispatch', async () => {})
        await finishDownload(previous, earlier, { withoutMetadata: true })
        const record = await InstalledResource.findByOrFail('resource_id', current)
        assert.equal(
          record.file_path,
          scenario === 'superseded' ? pathFor(current, latest) : pathFor(previous, earlier)
        )
        assert.equal(embed.mock.callCount(), 0)
      }
    )
  }

  for (const initiallyEmpty of [false, true]) {
    test(
      'a download wins while boot scans ' +
        (initiallyEmpty ? 'an empty directory' : 'an older edition'),
      async ({ assert }) => {
        await cache()
        if (!initiallyEmpty) await install(currentId, earlier, pathFor(oldId, earlier))
        const scanned = Promise.withResolvers<void>()
        const resume = Promise.withResolvers<void>()
        const original = fsPromises.readdir.bind(fsPromises)
        let intercepted = false
        const change = mock.method(fsPromises, 'readdir', async (...args: any[]) => {
          const entries = await (original as any)(...args)
          if (!intercepted && String(args[0]) === join(process.cwd(), 'storage/zim')) {
            intercepted = true
            scanned.resolve()
            await resume.promise
          }
          return entries
        })
        syncBuiltinESMExports()
        try {
          const boot = service.reconcileFromFilesystem()
          await scanned.promise
          const downloaded = finishDownload(currentId, latest)
          try {
            await Promise.race([downloaded, delay(400)])
          } finally {
            resume.resolve()
            await Promise.all([boot, downloaded])
          }
          const current = await InstalledResource.findByOrFail('resource_id', currentId)
          assert.equal(current.file_path, pathFor(currentId, latest))
          assert.equal(await readFile(current.file_path, 'utf8'), 'done')
        } finally {
          resume.resolve()
          change.mock.restore()
          syncBuiltinESMExports()
        }
      }
    )
  }
})
