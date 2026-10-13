import { test } from '@japa/runner'
import { decideOrphans } from '../../app/utils/kb_orphan_decision.js'

const ZIM = '/app/storage/zim'
const UPLOADS = '/app/storage/kb_uploads'

test.group('knowledge-base orphan sweep', () => {
  test('keeps ZIM vectors when its folder is empty but uploads are present', ({ assert }) => {
    const result = decideOrphans({
      sourcesInQdrant: [`${ZIM}/one.zim`, `${ZIM}/two.zim`, `${UPLOADS}/here.pdf`],
      filesOnDisk: [`${UPLOADS}/here.pdf`],
      embeddableFiles: [`${UPLOADS}/here.pdf`],
      scannedRoots: [ZIM, UPLOADS],
    })
    assert.deepEqual(result, {
      orphans: [],
      withheld: [{ root: ZIM, count: 2, reason: 'empty_root' }],
    })
  })

  test('keeps an unexpectedly large partial-root purge', ({ assert }) => {
    const indexed = Array.from({ length: 10 }, (_, i) => `${ZIM}/${i}.zim`)
    const present = indexed.slice(0, 4)
    const result = decideOrphans({
      sourcesInQdrant: indexed,
      filesOnDisk: present,
      embeddableFiles: present,
      scannedRoots: [ZIM],
    })
    assert.deepEqual(result, {
      orphans: [],
      withheld: [{ root: ZIM, count: 6, reason: 'mass_removal' }],
    })
  })

  test('still purges a missing file under a populated root', ({ assert }) => {
    const result = decideOrphans({
      sourcesInQdrant: [`${ZIM}/old.zim`, `${ZIM}/here.zim`],
      filesOnDisk: [`${ZIM}/here.zim`],
      embeddableFiles: [`${ZIM}/here.zim`],
      scannedRoots: [ZIM],
    })
    assert.deepEqual(result, { orphans: [`${ZIM}/old.zim`], withheld: [] })
  })

  test('does not purge a present file whose type is no longer indexable', ({ assert }) => {
    const result = decideOrphans({
      sourcesInQdrant: [`${ZIM}/legacy.bin`, `${ZIM}/old.zim`, `${ZIM}/here.zim`],
      filesOnDisk: [`${ZIM}/legacy.bin`, `${ZIM}/here.zim`],
      embeddableFiles: [`${ZIM}/here.zim`],
      scannedRoots: [ZIM],
    })
    assert.deepEqual(result, { orphans: [`${ZIM}/old.zim`], withheld: [] })
  })
})
