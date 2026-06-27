/**
 * Standalone test for the superseded-file deletion decision (#858).
 *
 * `decideSupersededDeletion` is pure (only node:path), so it runs under
 * `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/superseded_resource.standalone.ts
 */
import assert from 'node:assert/strict'
import { decideSupersededDeletion } from '../../app/utils/superseded_resource.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const BASE = '/app/storage/zim'

check('a newer version supersedes the old file', () => {
  const d = decideSupersededDeletion({
    existing: { file_path: `${BASE}/medicine_2026-03.zim`, version: '2026-03' },
    newFilePath: `${BASE}/medicine_2026-05.zim`,
    newVersion: '2026-05',
    newFileExists: true,
    storageBaseDir: BASE,
  })
  assert.equal(d.delete, true)
  assert.equal(d.reason, 'superseded')
  assert.equal(d.path, `${BASE}/medicine_2026-03.zim`)
})

check('first install (no prior row) deletes nothing', () => {
  const d = decideSupersededDeletion({
    existing: null,
    newFilePath: `${BASE}/a_2026-05.zim`,
    newVersion: '2026-05',
    newFileExists: true,
    storageBaseDir: BASE,
  })
  assert.equal(d.delete, false)
  assert.equal(d.reason, 'first_install')
})

check('a re-install of the same path deletes nothing', () => {
  const d = decideSupersededDeletion({
    existing: { file_path: `${BASE}/a_2026-05.zim`, version: '2026-05' },
    newFilePath: `${BASE}/a_2026-05.zim`,
    newVersion: '2026-05',
    newFileExists: true,
    storageBaseDir: BASE,
  })
  assert.equal(d.delete, false)
  assert.equal(d.reason, 'same_file')
})

check('a downgrade never deletes the newer file already on disk', () => {
  const d = decideSupersededDeletion({
    existing: { file_path: `${BASE}/a_2026-05.zim`, version: '2026-05' },
    newFilePath: `${BASE}/a_2026-03.zim`,
    newVersion: '2026-03',
    newFileExists: true,
    storageBaseDir: BASE,
  })
  assert.equal(d.delete, false)
  assert.equal(d.reason, 'not_newer')
})

check('a missing new file blocks the delete', () => {
  const d = decideSupersededDeletion({
    existing: { file_path: `${BASE}/a_2026-03.zim`, version: '2026-03' },
    newFilePath: `${BASE}/a_2026-05.zim`,
    newVersion: '2026-05',
    newFileExists: false,
    storageBaseDir: BASE,
  })
  assert.equal(d.delete, false)
  assert.equal(d.reason, 'new_file_missing')
})

// security-critical: a malformed prior path must never direct a delete outside the store
check('a prior path outside the storage dir is refused (path-traversal guard)', () => {
  const d = decideSupersededDeletion({
    existing: { file_path: '/app/storage/mysql/data.ibd', version: '2026-03' },
    newFilePath: `${BASE}/a_2026-05.zim`,
    newVersion: '2026-05',
    newFileExists: true,
    storageBaseDir: BASE,
  })
  assert.equal(d.delete, false)
  assert.equal(d.reason, 'outside_storage')
})

console.log(`\n${passed} passed`)
