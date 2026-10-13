import assert from 'node:assert/strict'
import { join } from 'node:path'
import { isSafeOldContentPath } from '../../app/utils/content_path.ts'

const root = '/app/storage/zim'
const mapRoot = '/app/storage/maps/pmtiles'
let passed = 0
function check(name: string, actual: boolean, expected: boolean) {
  assert.equal(actual, expected, name)
  passed++
  console.log(`  ok - ${name}`)
}

check(
  'own prior ZIM is removable',
  isSafeOldContentPath(join(root, 'book_2025.zim'), 'book', root),
  true
)
check(
  'own prior map is removable',
  isSafeOldContentPath(join(mapRoot, 'region_2025.pmtiles'), 'region', mapRoot),
  true
)
check(
  'another resource is protected',
  isSafeOldContentPath(join(root, 'other_2025.zim'), 'book', root),
  false
)
check(
  'parent traversal is protected',
  isSafeOldContentPath(join(root, '..', 'secret'), 'book', root),
  false
)
check(
  'sibling folder is protected',
  isSafeOldContentPath('/app/storage/zim-backup/book_2025.zim', 'book', root),
  false
)
check(
  'empty resource id is protected',
  isSafeOldContentPath(join(root, '_2025.zim'), '', root),
  false
)

console.log(`\n${passed} passed`)
