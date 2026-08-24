/**
 * Standalone tests for the knowledge base orphan sweep (caweis#50).
 *
 *   node --experimental-strip-types tests/standalone/kb_orphan_decision.standalone.ts
 *
 * This code deletes vectors. The two tests that matter most are the ones that
 * prove it declines to: an empty disk scan must reap nothing, and NOMAD's own
 * bundled docs must never be candidates. Either one getting this wrong empties
 * a knowledge base that took hours to build on a box with no internet.
 */
import assert from 'node:assert/strict'
import { decideOrphans, filterOrphanCandidates } from '../../app/utils/kb_orphan_decision.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const KB = '/app/storage/kb_uploads'
const ZIM = '/app/storage/zim'
const ROOTS = { kbUploadsPath: KB, zimPath: ZIM }

// ── The refusal cases. These are the ones worth having. ──
check('an empty disk scan reaps nothing, and says so with null', () => {
  // Indistinguishable from a filesystem hiccup or a mount that has not come up.
  // null means "no information", and the caller must not read it as "no orphans".
  assert.equal(decideOrphans([`${ZIM}/medicine.zim`], []), null)
})

check("NOMAD's own bundled docs are never orphan candidates", () => {
  // discoverNomadDocs embeds these, and they live outside both scan roots, so a
  // sweep that did not filter would purge the product's own documentation.
  const candidates = filterOrphanCandidates(
    ['/app/docs/getting-started.md', '/app/README.md', `${ZIM}/medicine.zim`],
    ROOTS
  )
  assert.deepEqual(candidates, [`${ZIM}/medicine.zim`])
})

check('a sibling directory sharing a name prefix is not swept', () => {
  // "/app/storage/zim-backup" starts with "/app/storage/zim" as a string.
  const candidates = filterOrphanCandidates(
    [`${ZIM}-backup/old.zim`, `${KB}-archive/old.pdf`, `${ZIM}/live.zim`],
    ROOTS
  )
  assert.deepEqual(candidates, [`${ZIM}/live.zim`])
})

check('the root itself, with no trailing separator, is not a candidate', () => {
  assert.deepEqual(filterOrphanCandidates([ZIM, KB], ROOTS), [])
})

check('empty scan roots produce no candidates rather than sweeping everything', () => {
  assert.deepEqual(
    filterOrphanCandidates([`${ZIM}/a.zim`], { kbUploadsPath: '', zimPath: '' }),
    []
  )
})

// ── The actual sweep ──
check('a source with no file behind it is an orphan', () => {
  const orphans = decideOrphans(
    [`${ZIM}/deleted.zim`, `${ZIM}/present.zim`],
    [`${ZIM}/present.zim`]
  )
  assert.deepEqual(orphans, [`${ZIM}/deleted.zim`])
})

check('a healthy library reports no orphans', () => {
  const files = [`${ZIM}/a.zim`, `${KB}/b.pdf`]
  assert.deepEqual(decideOrphans(files, files), [])
})

check('a file on disk that was never embedded is not an orphan', () => {
  // The forward direction is decideScanAction's job, not this one's.
  assert.deepEqual(decideOrphans([], [`${ZIM}/new.zim`]), [])
})

check('every orphan is reported, not just the first', () => {
  const orphans = decideOrphans(
    [`${ZIM}/x.zim`, `${ZIM}/y.zim`, `${KB}/z.pdf`, `${KB}/keep.pdf`],
    [`${KB}/keep.pdf`]
  )
  assert.deepEqual(orphans, [`${ZIM}/x.zim`, `${ZIM}/y.zim`, `${KB}/z.pdf`])
})

check('the two helpers compose the way the caller uses them', () => {
  // filter first, then decide — so docs are excluded before anything is reaped.
  const inQdrant = ['/app/docs/faq.md', `${ZIM}/gone.zim`, `${ZIM}/here.zim`]
  const onDisk = [`${ZIM}/here.zim`]
  const orphans = decideOrphans(filterOrphanCandidates(inQdrant, ROOTS), onDisk)
  assert.deepEqual(orphans, [`${ZIM}/gone.zim`])
  assert.ok(!orphans!.includes('/app/docs/faq.md'))
})

console.log(`\n${passed} passed`)
