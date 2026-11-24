import { test } from '@japa/runner'
import { Database } from '@adonisjs/lucid/database'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WikipediaSelection from '#models/wikipedia_selection'
import { DockerService } from '#services/docker_service'
import { ZimService } from '#services/zim_service'
import { isManagedWikipediaFile } from '../../app/utils/wikipedia_reconcile.js'
import CreateSelections from '../../database/migrations/1769500000001_create_wikipedia_selection_table.js'
import CreateManifests from '../../database/migrations/1770849108030_create_create_collection_manifests_table.js'
import RepairSelections from '../../database/migrations/1795530000000_repair_preview_wikipedia_medicine_selection.js'

const medicine = 'wikipedia_en_medicine_maxi_2026-10.zim'
const selection = {
  option_id: 'unknown',
  status: 'installed',
  filename: medicine,
  url: `https://mirror.example.org/zim/${medicine}?download=1`,
}
const top = 'wikipedia_en_top_mini_2026-06.zim'

function manifestWith(id: string, url: string | null) {
  return JSON.stringify({
    spec_version: '2026-08-02',
    options: [
      { id, name: 'Library', description: 'Offline edition', size_mb: 1, version: null, url },
    ],
  })
}

test.group('preview Wikipedia selection repair', (group) => {
  let database: Database

  group.each.setup(async () => {
    database = new Database(
      {
        connection: 'fixture',
        connections: {
          fixture: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
          },
        },
      },
      logger,
      emitter
    )
    const db = database.connection()
    await new CreateSelections(db, 'create_selections').execUp()
    await new CreateManifests(db, 'create_manifests').execUp()
    return () => database.manager.closeAll()
  })

  const runRepair = () =>
    database.transaction((trx) => new RepairSelections(trx, 'repair_preview_selection').execUp())

  const cache = (spec: string) =>
    database.table('collection_manifests').insert({
      type: 'wikipedia',
      spec_version: '2026-08-02',
      spec_data: spec,
      fetched_at: '2026-11-24 00:00:00',
    })

  test('clears only the exact preview signature and can run twice', async ({ assert }) => {
    const rows = [
      selection,
      { ...selection, option_id: 'custom' },
      { ...selection, option_id: 'all-mini' },
      { ...selection, option_id: 'none' },
      { ...selection, status: 'downloading' },
      { ...selection, status: 'failed' },
      { ...selection, filename: null },
      { ...selection, url: null },
      { ...selection, url: 'not a URL' },
      { ...selection, url: `https://mirror.example.org/${top}` },
      { ...selection, url: `https://mirror.example.org/${medicine.replace('2026-10', '2026-04')}` },
      { ...selection, filename: top, url: `https://mirror.example.org/${top}` },
      { ...selection, filename: 'preferred.zim', url: 'https://mirror.example.org/preferred.zim' },
      { ...selection, url: `file:///local/${medicine}` },
      {
        ...selection,
        filename: 'wikipedia_en_medicine_maxi_2026-13.zim',
        url: 'https://mirror.example.org/wikipedia_en_medicine_maxi_2026-13.zim',
      },
    ]
    await database.table('wikipedia_selections').multiInsert(rows)
    const readRows = () => database.from('wikipedia_selections').orderBy('id')
    const before = await readRows()
    const expected = [
      { ...before[0], option_id: 'none', status: 'none', url: null, filename: null },
      ...before.slice(1),
    ]

    await runRepair()
    assert.deepEqual(await readRows(), expected)
    await runRepair()
    assert.deepEqual(await readRows(), expected)
  })

  test('repairs a preview row with a valid cache that excludes Medicine', async ({ assert }) => {
    await cache(manifestWith('top-mini', `https://mirror.example.org/${top}`))
    await database.table('wikipedia_selections').insert(selection)
    await runRepair()
    const repaired = await database.from('wikipedia_selections').firstOrFail()
    assert.equal(repaired.option_id, 'none')
    assert.isNull(repaired.filename)
  })

  test('choosing None after the repair leaves the tier file on disk for reconciliation', async ({
    assert,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'nomad-wikipedia-repair-'))
    try {
      const path = join(directory, medicine)
      await writeFile(path, 'Medicine tier fixture')
      await database.table('wikipedia_selections').insert(selection)
      await runRepair()

      await database.transaction(async (trx) => {
        const docker = new DockerService()
        docker.affectContainer = async () => ({ success: true, message: 'Fixture restart' })
        const service = new ZimService(docker)
        service.getWikipediaOptions = async () => [
          { id: 'none', name: 'None', description: '', size_mb: 0, url: null },
        ]
        const row = await WikipediaSelection.query({ client: trx }).firstOrFail()
        row.useTransaction(trx)
        service.getWikipediaSelection = async () => row
        service.delete = (name) => unlink(join(directory, name))
        await service.selectWikipedia('none')
        assert.isFalse(isManagedWikipediaFile(medicine, row.filename))
      })
      assert.equal(await readFile(path, 'utf8'), 'Medicine tier fixture')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  const duplicated = JSON.parse(manifestWith('top-mini', `https://mirror.example.org/${top}`))
  duplicated.options.push({ ...duplicated.options[0] })
  const protectedCaches = [
    ['duplicate selector IDs', JSON.stringify(duplicated)],
    [
      'a stock option ID pointing to Medicine',
      manifestWith('top-mini', `https://mirror.example.org/${medicine}`),
    ],
    [
      'a stock option with a malformed edition',
      manifestWith('top-mini', 'https://mirror.example.org/wikipedia_en_top_mini_2026-13.zim'),
    ],
    [
      'a custom Medicine selector on another mirror and edition',
      manifestWith('travel', 'https://other.example.org/wikipedia_en_medicine_maxi_2026-04.zim'),
    ],
    ['an explicit unknown option', manifestWith('unknown', `https://mirror.example.org/${top}`)],
    [
      'a custom selector without a dated filename',
      manifestWith('custom', 'https://mirror.example.org/preferred.zim'),
    ],
    ['a missing option URL', manifestWith('custom', null)],
    ['a missing option list', '{}'],
    ['an empty option list', '{"options":[]}'],
    ['an invalid option', '{"options":[{}]}'],
    ['invalid JSON', '{'],
  ]
  for (const [description, spec] of protectedCaches) {
    test(`preserves selections for ${description}`, async ({ assert }) => {
      await cache(spec)
      await database.table('wikipedia_selections').insert(selection)
      const before = await database.from('wikipedia_selections').firstOrFail()
      await runRepair()
      assert.deepEqual(await database.from('wikipedia_selections').firstOrFail(), before)
    })
  }
})
