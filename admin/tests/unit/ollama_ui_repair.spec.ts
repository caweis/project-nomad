import { test } from '@japa/runner'
import knex from 'knex'
import Migration from '../../database/migrations/1794740000000_restore_ollama_ui_location.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'

test('Ollama repair changes only overwritten UI locations and is idempotent', async ({
  assert,
}) => {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })
  try {
    await db.schema.createTable('services', (table) => {
      table.increments('id')
      table.string('service_name')
      table.string('ui_location').nullable()
      table.string('container_config')
      table.boolean('is_user_modified')
    })
    for (const location of [
      null,
      '11434',
      'https:11434',
      '/chat',
      '/custom-chat',
      'https://chat.example',
    ]) {
      await db('services').insert({
        service_name: SERVICE_NAMES.OLLAMA,
        ui_location: location,
        container_config: 'preserve',
        is_user_modified: true,
      })
    }
    await db('services').insert({
      service_name: 'nomad_kiwix',
      ui_location: '8081',
      container_config: 'preserve',
      is_user_modified: true,
    })
    const run = async () => {
      let deferred: any
      await Migration.prototype.up.call({
        defer: (fn: unknown) => {
          deferred = fn
        },
      } as any)
      await deferred(db)
    }
    await run()
    const rows = await db('services').orderBy('id')
    assert.deepEqual(
      rows.map((r) => r.ui_location),
      ['/chat', '/chat', '/chat', '/chat', '/custom-chat', 'https://chat.example', '8081']
    )
    assert.isTrue(rows.every((r) => r.container_config === 'preserve' && r.is_user_modified === 1))
    await run()
    assert.deepEqual(await db('services').orderBy('id'), rows)
  } finally {
    await db.destroy()
  }
})
