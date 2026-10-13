/**
 * Standalone checks for the knowledge-base orphan sweep. A wrong decision
 * deletes Qdrant vectors, so the refusal and cleanup cases both matter.
 *
 *   node tests/standalone/kb_orphan_decision.standalone.ts
 */
import assert from 'node:assert/strict'
import { decideOrphans, filterOrphanCandidates } from '../../app/utils/kb_orphan_decision.ts'

const KB = '/app/storage/kb_uploads'
const ZIM = '/app/storage/zim'
const ROOTS = [KB, ZIM]
let passed = 0

function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

function decide(
  sourcesInQdrant: string[],
  filesOnDisk: string[],
  scannedRoots = ROOTS,
  embeddableFiles = filesOnDisk
) {
  return decideOrphans({ sourcesInQdrant, filesOnDisk, embeddableFiles, scannedRoots })
}

check('no scanned roots cannot authorize a purge', () => {
  assert.deepEqual(decide([`${ZIM}/old.zim`], [], []), { orphans: [], withheld: [] })
})

check('bundled docs and sibling directories are outside the scan roots', () => {
  const candidates = filterOrphanCandidates(
    ['/app/docs/faq.md', `${ZIM}-backup/old.zim`, `${KB}-archive/old.pdf`, `${ZIM}/a.zim`],
    ROOTS
  )
  assert.deepEqual(candidates, [`${ZIM}/a.zim`])
  assert.deepEqual(filterOrphanCandidates([KB, ZIM], ROOTS), [])
})

check('a missing ZIM root is excluded while a healthy uploads root is swept', () => {
  const indexed = [`${ZIM}/old.zim`, `${KB}/old.pdf`, `${KB}/here.pdf`]
  const result = decide(indexed, [`${KB}/here.pdf`], [KB])
  assert.deepEqual(result, { orphans: [`${KB}/old.pdf`], withheld: [] })
})

check('an empty but present ZIM root with an upload keeps its vectors', () => {
  const indexed = [`${ZIM}/one.zim`, `${ZIM}/two.zim`, `${KB}/here.pdf`]
  const result = decide(indexed, [`${KB}/here.pdf`])
  assert.deepEqual(result, {
    orphans: [],
    withheld: [{ root: ZIM, count: 2, reason: 'empty_root' }],
  })
})

check('a ZIM root containing only a generated catalog is still withheld', () => {
  const result = decide([`${ZIM}/old.zim`], [`${ZIM}/kiwix-library.xml`], [ZIM], [])
  assert.deepEqual(result, {
    orphans: [],
    withheld: [{ root: ZIM, count: 1, reason: 'empty_root' }],
  })
})

check('a small orphan under a populated root is purged', () => {
  const result = decide([`${ZIM}/gone.zim`, `${ZIM}/here.zim`], [`${ZIM}/here.zim`], [ZIM])
  assert.deepEqual(result, { orphans: [`${ZIM}/gone.zim`], withheld: [] })
})

check('an unrecognized but present file is never called missing', () => {
  const result = decide(
    [`${ZIM}/legacy.bin`, `${ZIM}/gone.zim`, `${ZIM}/here.zim`],
    [`${ZIM}/legacy.bin`, `${ZIM}/here.zim`],
    [ZIM],
    [`${ZIM}/here.zim`]
  )
  assert.deepEqual(result, { orphans: [`${ZIM}/gone.zim`], withheld: [] })
})

check('a healthy library and an unindexed new file have no orphans', () => {
  const files = [`${ZIM}/a.zim`, `${KB}/b.pdf`]
  assert.deepEqual(decide(files, files), { orphans: [], withheld: [] })
  assert.deepEqual(decide([], files), { orphans: [], withheld: [] })
})

check('most indexed files missing under one root withholds that root', () => {
  const indexed = Array.from({ length: 10 }, (_, i) => `${ZIM}/${i}.zim`)
  const result = decide(indexed, indexed.slice(0, 4), [ZIM])
  assert.deepEqual(result, {
    orphans: [],
    withheld: [{ root: ZIM, count: 6, reason: 'mass_removal' }],
  })
})

check('exactly half missing stays below the mass-removal threshold', () => {
  const indexed = Array.from({ length: 10 }, (_, i) => `${ZIM}/${i}.zim`)
  assert.deepEqual(decide(indexed, indexed.slice(0, 5), [ZIM]), {
    orphans: indexed.slice(5),
    withheld: [],
  })
})

check('fewer than five missing remain a small cleanup', () => {
  const indexed = Array.from({ length: 5 }, (_, i) => `${ZIM}/${i}.zim`)
  assert.deepEqual(decide(indexed, indexed.slice(0, 1), [ZIM]), {
    orphans: indexed.slice(1),
    withheld: [],
  })
})

check('a withheld ZIM root does not block valid cleanup in uploads', () => {
  const result = decide([`${ZIM}/lost.zim`, `${KB}/lost.pdf`, `${KB}/here.pdf`], [`${KB}/here.pdf`])
  assert.deepEqual(result, {
    orphans: [`${KB}/lost.pdf`],
    withheld: [{ root: ZIM, count: 1, reason: 'empty_root' }],
  })
})

console.log(`\n${passed} passed`)
