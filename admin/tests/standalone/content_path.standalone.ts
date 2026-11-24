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
  isSafeOldContentPath(join(root, 'book_2025.zim'), 'book', root, 'zim'),
  true
)
check(
  'own prior map is removable',
  isSafeOldContentPath(join(mapRoot, 'region_2025.pmtiles'), 'region', mapRoot, 'map'),
  true
)
check(
  'another resource is protected',
  isSafeOldContentPath(join(root, 'other_2025.zim'), 'book', root, 'zim'),
  false
)
check(
  'parent traversal is protected',
  isSafeOldContentPath(join(root, '..', 'secret'), 'book', root, 'zim'),
  false
)
check(
  'sibling folder is protected',
  isSafeOldContentPath('/app/storage/zim-backup/book_2025.zim', 'book', root, 'zim'),
  false
)
check(
  'empty resource id is protected',
  isSafeOldContentPath(join(root, '_2025.zim'), '', root, 'zim'),
  false
)

const aliases = new Map([['old_book', 'book']])
check(
  'its previous ID matches exactly',
  isSafeOldContentPath(join(root, 'old_book_2025-07.zim'), 'book', root, 'zim', aliases),
  true
)
check(
  'a day-specific edition matches',
  isSafeOldContentPath(join(root, 'old_book_2025-07-01.zim'), 'book', root, 'zim', aliases),
  true
)
check(
  'a longer former ID is a different book',
  isSafeOldContentPath(join(root, 'old_book_maxi_2025-07.zim'), 'book', root, 'zim', aliases),
  false
)
check(
  'a wrong extension is protected',
  isSafeOldContentPath(join(root, 'book_2025-07.pmtiles'), 'book', root, 'zim'),
  false
)
check(
  'a missing extension is protected',
  isSafeOldContentPath(join(root, 'book_2025-07'), 'book', root, 'zim'),
  false
)
check(
  'a subdirectory is protected',
  isSafeOldContentPath(join(root, 'sub/book_2025-07.zim'), 'book', root, 'zim'),
  false
)
check(
  'ZIM aliases cannot match a map',
  isSafeOldContentPath(join(mapRoot, 'old_book_2025-07.pmtiles'), 'book', mapRoot, 'map', aliases),
  false
)

console.log(`\n${passed} passed`)
