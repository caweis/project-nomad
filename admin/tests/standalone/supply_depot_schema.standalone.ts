/**
 * Standalone schema + reseed-sync test for the Supply Depot custom-app columns (S1).
 *
 * Two things are asserted without booting Adonis/MySQL (which can't run under
 * `node --experimental-strip-types`):
 *
 *   1. Schema replay — an in-memory node:sqlite `services` table is built up the way the
 *      migrations build the real one (the Wave-1 supply-depot columns plus the new
 *      is_user_modified / auto_update_* / custom_url columns), and every new column is
 *      asserted to exist.
 *
 *   2. Reseed-sync decision — the seeder now UPDATEs existing curated rows on every run
 *      (behaviour-changing vs. the old create-only seeder). The decision is the pure
 *      `shouldReseedCuratedRow` helper the seeder actually calls; this drives it directly,
 *      then simulates a full reseed against an in-memory table to prove an is_user_modified
 *      row keeps its edited config while a clean curated row gets re-synced.
 *
 * Run: node --experimental-strip-types tests/standalone/supply_depot_schema.standalone.ts
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { shouldReseedCuratedRow } from '../../app/services/reseed_sync.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── 1. Schema replay: build the services table the way the migrations do ───────
function buildServicesTable(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  // Base columns relevant to the test (mirrors the create + Wave-1 supply-depot migration).
  db.exec(`
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_name TEXT NOT NULL,
      container_config TEXT,
      container_command TEXT,
      metadata TEXT,
      category TEXT,
      ui_location TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0
    )
  `)
  // 1772000000002_add_user_modified_to_services
  db.exec(`ALTER TABLE services ADD COLUMN is_user_modified INTEGER NOT NULL DEFAULT 0`)
  // 1772000000003_add_app_auto_update_fields_to_services
  db.exec(`ALTER TABLE services ADD COLUMN auto_update_enabled INTEGER NOT NULL DEFAULT 0`)
  db.exec(`ALTER TABLE services ADD COLUMN available_update_first_seen_at TEXT`)
  db.exec(`ALTER TABLE services ADD COLUMN auto_update_consecutive_failures INTEGER NOT NULL DEFAULT 0`)
  db.exec(`ALTER TABLE services ADD COLUMN auto_update_disabled_reason TEXT`)
  // 1776200000001_add_custom_url_to_services
  db.exec(`ALTER TABLE services ADD COLUMN custom_url TEXT`)
  return db
}

function columnNames(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(services)`).all() as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

check('every new Supply Depot column exists after the migration replay', () => {
  const db = buildServicesTable()
  const cols = columnNames(db)
  for (const c of [
    'is_user_modified',
    'auto_update_enabled',
    'available_update_first_seen_at',
    'auto_update_consecutive_failures',
    'auto_update_disabled_reason',
    'custom_url',
  ]) {
    assert.ok(cols.has(c), `column ${c} should exist`)
  }
  db.close()
})

check('new boolean/int columns default correctly (auto-update off, no failures)', () => {
  const db = buildServicesTable()
  db.prepare(`INSERT INTO services (service_name) VALUES (?)`).run('curated-app')
  const row = db
    .prepare(
      `SELECT is_user_modified, auto_update_enabled, auto_update_consecutive_failures,
              available_update_first_seen_at, auto_update_disabled_reason, custom_url
       FROM services WHERE service_name = ?`
    )
    .get('curated-app') as Record<string, unknown>
  assert.equal(row.is_user_modified, 0)
  assert.equal(row.auto_update_enabled, 0)
  assert.equal(row.auto_update_consecutive_failures, 0)
  assert.equal(row.available_update_first_seen_at, null)
  assert.equal(row.auto_update_disabled_reason, null)
  assert.equal(row.custom_url, null)
  db.close()
})

// ── 2. Reseed-sync decision (the pure helper the seeder calls) ─────────────────
check('shouldReseedCuratedRow re-syncs a clean curated row', () => {
  assert.equal(shouldReseedCuratedRow({ is_custom: false, is_user_modified: false }), true)
})

check('shouldReseedCuratedRow skips a custom app', () => {
  assert.equal(shouldReseedCuratedRow({ is_custom: true, is_user_modified: false }), false)
})

check('shouldReseedCuratedRow skips a user-modified curated app', () => {
  assert.equal(shouldReseedCuratedRow({ is_custom: false, is_user_modified: true }), false)
})

check('shouldReseedCuratedRow skips a row that does not exist (undefined)', () => {
  assert.equal(shouldReseedCuratedRow(undefined), false)
})

// ── 2b. End-to-end reseed simulation: edits survive, clean curated re-synced ───
check('a reseed leaves an is_user_modified row untouched but re-syncs a clean curated row', () => {
  const db = buildServicesTable()
  const insert = db.prepare(
    `INSERT INTO services (service_name, container_config, is_custom, is_user_modified)
     VALUES (?, ?, ?, ?)`
  )
  // A curated app the user edited (changed its port to 9999) — must NOT be overwritten.
  const editedConfig = JSON.stringify({ HostConfig: { PortBindings: { '80/tcp': [{ HostPort: '9999' }] } } })
  insert.run('edited-kiwix', editedConfig, 0, 1)
  // A clean curated app — must be re-synced to the catalog config.
  const staleConfig = JSON.stringify({ HostConfig: { PortBindings: { '80/tcp': [{ HostPort: '8090' }] } } })
  insert.run('clean-kiwix', staleConfig, 0, 0)
  // A custom app — must NOT be overwritten.
  insert.run('my-custom', '{"custom":true}', 1, 0)

  // The catalog config the seeder would push for both curated names.
  const catalogConfig = JSON.stringify({ HostConfig: { PortBindings: { '80/tcp': [{ HostPort: '8091' }] } } })

  const rows = db
    .prepare(`SELECT service_name, container_config, is_custom, is_user_modified FROM services`)
    .all() as { service_name: string; container_config: string; is_custom: number; is_user_modified: number }[]

  const update = db.prepare(`UPDATE services SET container_config = ? WHERE service_name = ?`)
  for (const r of rows) {
    const existing = { is_custom: !!r.is_custom, is_user_modified: !!r.is_user_modified }
    if (shouldReseedCuratedRow(existing)) {
      update.run(catalogConfig, r.service_name)
    }
  }

  const after = (name: string) =>
    (db.prepare(`SELECT container_config FROM services WHERE service_name = ?`).get(name) as {
      container_config: string
    }).container_config

  assert.equal(after('edited-kiwix'), editedConfig, 'user-modified row must keep its edited config')
  assert.equal(after('clean-kiwix'), catalogConfig, 'clean curated row must be re-synced')
  assert.equal(after('my-custom'), '{"custom":true}', 'custom app must be untouched')
  db.close()
})

console.log(`\n${passed} checks passed`)
