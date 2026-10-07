/**
 * Which file's knowledge to forget after a content download finishes: only a
 * ZIM that a new edition replaced and whose old file was really deleted.
 *
 * Run: node --experimental-strip-types tests/standalone/kb_replaced_file.standalone.ts
 */
import assert from 'node:assert/strict'
import { replacedFileToForget } from '../../app/utils/kb_replaced_file.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const OLD = '/storage/zim/wikipedia_en_all_maxi_2026-06.zim'
const NEW = '/storage/zim/wikipedia_en_all_maxi_2026-09.zim'

check('a ZIM replaced by a newer edition, old file deleted: forget the old file', () => {
  assert.equal(
    replacedFileToForget({
      filetype: 'zim',
      oldFilePath: OLD,
      newFilePath: NEW,
      oldFileDeleted: true,
    }),
    OLD
  )
})

check(
  'the old file is still on disk (the delete failed): its passages are still true of it',
  () => {
    assert.equal(
      replacedFileToForget({
        filetype: 'zim',
        oldFilePath: OLD,
        newFilePath: NEW,
        oldFileDeleted: false,
      }),
      null
    )
  }
)

check('a fresh install has no old file', () => {
  assert.equal(
    replacedFileToForget({
      filetype: 'zim',
      oldFilePath: null,
      newFilePath: NEW,
      oldFileDeleted: false,
    }),
    null
  )
  assert.equal(
    replacedFileToForget({
      filetype: 'zim',
      oldFilePath: '',
      newFilePath: NEW,
      oldFileDeleted: true,
    }),
    null
  )
})

check('the same file downloaded again is not a replacement, and must keep its passages', () => {
  assert.equal(
    replacedFileToForget({
      filetype: 'zim',
      oldFilePath: NEW,
      newFilePath: NEW,
      oldFileDeleted: true,
    }),
    null
  )
})

check('a map is not in the knowledge base, so there is nothing to forget', () => {
  assert.equal(
    replacedFileToForget({
      filetype: 'map',
      oldFilePath: '/storage/maps/pmtiles/a.pmtiles',
      newFilePath: '/storage/maps/pmtiles/b.pmtiles',
      oldFileDeleted: true,
    }),
    null
  )
})

check('a path that only looks similar is still a different file', () => {
  assert.equal(
    replacedFileToForget({
      filetype: 'zim',
      oldFilePath: '/storage/zim/a.zim',
      newFilePath: '/storage/zim/a.zim.part',
      oldFileDeleted: true,
    }),
    '/storage/zim/a.zim'
  )
})

console.log(`\n${passed} checks passed`)
