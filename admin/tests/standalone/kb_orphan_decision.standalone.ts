/**
 * Standalone tests for the knowledge base orphan sweep (caweis#50) and its
 * per-root guards (upstream #1393, their issue #1378).
 *
 *   node --experimental-strip-types tests/standalone/kb_orphan_decision.standalone.ts
 *
 * This code deletes vectors. The tests that matter most are the ones that
 * prove it declines to: a root that holds nothing, a root that would lose most
 * of its sources at once, and NOMAD's own bundled docs. Any of those going
 * wrong empties a knowledge base that took hours to build on a box with no
 * internet.
 */
import assert from 'node:assert/strict'
import {
  decideOrphans,
  describeWithheld,
  filterOrphanCandidates,
  ORPHAN_PURGE_MIN_GUARDED,
} from '../../app/utils/kb_orphan_decision.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const KB = '/app/storage/kb_uploads'
const ZIM = '/app/storage/zim'
const ROOTS = [KB, ZIM]

/** By default every file on disk is also embeddable, which is the common case. */
const decide = (
  sourcesInQdrant: string[],
  filesOnDisk: string[],
  scannedRoots: string[] = ROOTS,
  embeddableFiles: string[] = filesOnDisk
) => decideOrphans({ sourcesInQdrant, filesOnDisk, embeddableFiles, scannedRoots })

const zims = (n: number) => Array.from({ length: n }, (_, i) => `${ZIM}/z${i}.zim`)

// ── Candidates ──
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
  assert.deepEqual(filterOrphanCandidates([`${ZIM}/a.zim`], ['', '']), [])
  assert.deepEqual(filterOrphanCandidates([`${ZIM}/a.zim`], []), [])
})

check('no roots scanned at all decides nothing', () => {
  // "We could not read any of the storage" must never read as "nothing is on
  // disk, so purge everything."
  assert.deepEqual(decide([`${ZIM}/a.zim`], [], []), { orphans: [], withheld: [] })
})

// ── The sweep itself ──
check('a source with no file behind it is an orphan', () => {
  assert.deepEqual(decide([`${ZIM}/deleted.zim`, `${ZIM}/present.zim`], [`${ZIM}/present.zim`]), {
    orphans: [`${ZIM}/deleted.zim`],
    withheld: [],
  })
})

check('a healthy library reports no orphans', () => {
  const files = [`${ZIM}/a.zim`, `${KB}/b.pdf`]
  assert.deepEqual(decide(files, files), { orphans: [], withheld: [] })
})

check('a file on disk that was never embedded is not an orphan', () => {
  // The forward direction is decideScanAction's job, not this one's.
  assert.deepEqual(decide([], [`${ZIM}/new.zim`]), { orphans: [], withheld: [] })
})

check('every orphan is reported, not just the first', () => {
  const result = decide(
    [`${ZIM}/x.zim`, `${ZIM}/y.zim`, `${KB}/z.pdf`, `${KB}/keep.pdf`, `${ZIM}/keep.zim`],
    [`${KB}/keep.pdf`, `${ZIM}/keep.zim`]
  )
  assert.deepEqual(result.orphans, [`${KB}/z.pdf`, `${ZIM}/x.zim`, `${ZIM}/y.zim`])
  assert.deepEqual(result.withheld, [])
})

check('sources outside every scanned root are never orphans (bundled docs)', () => {
  const result = decide(['/app/README.md', `${ZIM}/a.zim`], [`${ZIM}/a.zim`])
  assert.deepEqual(result, { orphans: [], withheld: [] })
})

check('a root that was not there when the scan ran contributes nothing', () => {
  // Upstream f8a29693. The zim folder is missing (renamed, relocated, not yet
  // mounted) while kb_uploads has a file, so the scan is not empty. Only
  // kb_uploads was walked, so no ZIM may be reaped on a root nobody looked at.
  const inQdrant = [
    `${ZIM}/wikipedia.zim`,
    `${ZIM}/medicine.zim`,
    `${KB}/gone.pdf`,
    `${KB}/notes.pdf`,
  ]
  const result = decide(inQdrant, [`${KB}/notes.pdf`], [KB])
  assert.deepEqual(result, { orphans: [`${KB}/gone.pdf`], withheld: [] })
})

// ── Guard 1: a walked root that holds nothing (#1378) ──
check('a walked root with no files keeps its sources instead of purging them', () => {
  // The unmounted-volume shape. Boot runs ensureDirectoryExists() on the zim
  // root, so a drive that did not mount leaves an empty directory the scan
  // walks without error. kb_uploads keeps the overall scan non-empty. Treating
  // "walked and empty" as "everything under it was deleted" purged every ZIM.
  const inQdrant = [`${KB}/a.pdf`, `${ZIM}/wikipedia.zim`, `${ZIM}/gutenberg.zim`]
  assert.deepEqual(decide(inQdrant, [`${KB}/a.pdf`]), {
    orphans: [],
    withheld: [{ root: ZIM, count: 2, reason: 'empty_root' }],
  })
})

check('an empty disk scan withholds every root rather than purging any', () => {
  assert.deepEqual(decide([`${KB}/a.pdf`, `${ZIM}/a.zim`], []), {
    orphans: [],
    withheld: [
      { root: KB, count: 1, reason: 'empty_root' },
      { root: ZIM, count: 1, reason: 'empty_root' },
    ],
  })
})

check('kiwix-library.xml does not make an unmounted root look populated', () => {
  // Kiwix regenerates its library file in the empty mountpoint, so the folder
  // has an entry. That file is on disk but is not embeddable, and only
  // embeddable files are evidence that the content is there.
  const onDisk = [`${KB}/a.pdf`, `${ZIM}/kiwix-library.xml`]
  const embeddable = [`${KB}/a.pdf`]
  const result = decide([`${KB}/a.pdf`, `${ZIM}/wikipedia.zim`], onDisk, ROOTS, embeddable)
  assert.deepEqual(result.withheld, [{ root: ZIM, count: 1, reason: 'empty_root' }])
  assert.deepEqual(result.orphans, [])
})

check('an empty kb_uploads root keeps its sources while zim is swept normally', () => {
  // The roots fail independently, so each is decided on its own.
  const live = ['a', 'b', 'c'].map((n) => `${ZIM}/${n}.zim`)
  const result = decide([`${KB}/a.pdf`, ...live, `${ZIM}/gone.zim`], live)
  assert.deepEqual(result, {
    orphans: [`${ZIM}/gone.zim`],
    withheld: [{ root: KB, count: 1, reason: 'empty_root' }],
  })
})

check('a file still on disk is not an orphan even if its type is no longer embeddable', () => {
  // The fork measures "does a file exist" against everything on disk, not
  // against what it would embed today. If determineFileType ever stops
  // recognising a type, the vectors for files of that type must survive.
  const onDisk = [`${ZIM}/a.zim`, `${ZIM}/notes.legacy`]
  const embeddable = [`${ZIM}/a.zim`]
  const result = decide([`${ZIM}/a.zim`, `${ZIM}/notes.legacy`], onDisk, [ZIM], embeddable)
  assert.deepEqual(result, { orphans: [], withheld: [] })
})

// ── Guard 2: most of a root vanishing at once ──
check('removing most of a root in one sync is withheld as a likely wrong mount', () => {
  // The root is present and non-empty, but holds 2 of 10 indexed ZIMs: far
  // likelier a different disk or a stale copy than eight hand deletions.
  const indexed = zims(10)
  assert.deepEqual(decide(indexed, indexed.slice(0, 2)), {
    orphans: [],
    withheld: [{ root: ZIM, count: 8, reason: 'mass_removal' }],
  })
})

check("the share is a root's own, not diluted by everything else in the index", () => {
  // 8 of the 10 ZIMs are gone, which is 80% of the zim root but only 15% of
  // the 55 sources in the whole index once 45 healthy uploads are counted.
  const indexed = zims(10)
  const uploads = Array.from({ length: 45 }, (_, i) => `${KB}/u${i}.pdf`)
  const result = decide([...indexed, ...uploads], [...indexed.slice(0, 2), ...uploads])
  assert.deepEqual(result, {
    orphans: [],
    withheld: [{ root: ZIM, count: 8, reason: 'mass_removal' }],
  })
})

check('removing exactly half of a root is still purged', () => {
  // "More than half" is the line, so 5 of 10 is on the safe-to-purge side.
  const indexed = zims(10)
  assert.deepEqual(decide(indexed, indexed.slice(0, 5)), {
    orphans: indexed.slice(5),
    withheld: [],
  })
})

check('the mass-removal guard waits until there are enough sources to mean something', () => {
  assert.equal(ORPHAN_PURGE_MIN_GUARDED, 5)
  // 4 of 5 missing is 80%, but 4 is below the minimum: cheap to re-embed.
  const five = zims(5)
  assert.deepEqual(decide(five, five.slice(0, 1)), { orphans: five.slice(1), withheld: [] })
  // 5 of 6 missing is the first count the guard looks at.
  const six = zims(6)
  assert.deepEqual(decide(six, six.slice(0, 1)), {
    orphans: [],
    withheld: [{ root: ZIM, count: 5, reason: 'mass_removal' }],
  })
})

check("one root's guard does not hold back another root's ordinary purge", () => {
  const live = zims(2)
  const kb = Array.from({ length: 6 }, (_, i) => `${KB}/k${i}.pdf`)
  const result = decide([...kb, ...live, `${ZIM}/gone.zim`], [kb[0], ...live])
  assert.deepEqual(result.orphans, [`${ZIM}/gone.zim`])
  assert.deepEqual(result.withheld, [{ root: KB, count: 5, reason: 'mass_removal' }])
})

check('overlapping roots do not report the same orphan twice', () => {
  const result = decide(
    [`${ZIM}/sub/gone.zim`, `${ZIM}/kept.zim`],
    [`${ZIM}/kept.zim`],
    [ZIM, `${ZIM}/sub`],
    [`${ZIM}/kept.zim`, `${ZIM}/sub/other.zim`]
  )
  assert.deepEqual(result.orphans, [`${ZIM}/sub/gone.zim`])
})

check('the helpers compose the way the caller uses them', () => {
  // Bundled docs sit outside the roots; the deleted ZIM is the only orphan.
  const inQdrant = ['/app/docs/faq.md', `${ZIM}/gone.zim`, `${ZIM}/here.zim`]
  const result = decide(inQdrant, [`${ZIM}/here.zim`])
  assert.deepEqual(result.orphans, [`${ZIM}/gone.zim`])
  assert.ok(!result.orphans.includes('/app/docs/faq.md'))
})

// ── What the person who pressed Sync reads ──
check('nothing withheld adds nothing to the message', () => {
  const note = describeWithheld([], (r) => r)
  assert.equal(note, '')
})

check('the note names the folder, counts the sources, and says why', () => {
  const label = (root: string) => root.replace('/app/', '')
  assert.equal(
    describeWithheld([{ root: ZIM, count: 1, reason: 'empty_root' }], label),
    '; left 1 indexed source under storage/zim untouched because that folder has no files (is the drive mounted?)'
  )
  assert.equal(
    describeWithheld([{ root: ZIM, count: 8, reason: 'mass_removal' }], label),
    '; left 8 indexed sources under storage/zim untouched because removing them would clear most of that folder (is it pointing at the right drive?)'
  )
})

check('two withheld roots each get their own clause', () => {
  const note = describeWithheld(
    [
      { root: KB, count: 2, reason: 'empty_root' },
      { root: ZIM, count: 6, reason: 'mass_removal' },
    ],
    (r) => r
  )
  assert.equal(note.split('; left ').length - 1, 2)
  assert.ok(note.indexOf(KB) < note.indexOf(ZIM))
})

console.log(`\n${passed} passed`)
