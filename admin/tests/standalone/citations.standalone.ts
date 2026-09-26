/**
 * Standalone checks for the "Sources" list under an assistant answer.
 *
 *   node --experimental-strip-types tests/standalone/citations.standalone.ts
 *
 * Ported from upstream's rag_citations.spec.ts (#1179), which is node:test and
 * would register nothing under this fork's Japa glob. The rule they lock in is
 * that a citation may only ever name a document the model actually read: a
 * wrong one lends false weight to an answer the user has no other way to check.
 */
import assert from 'node:assert/strict'
import { buildCitations, parseStoredSources } from '../../app/utils/citations.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const chunk = (metadata: Record<string, any>) => ({ text: 'body', score: 0.5, metadata })

// ── buildCitations (upstream's nine) ──
check('collapses many chunks from one archive into a single entry', () => {
  const sources = buildCitations([
    chunk({ source: '/zim/survival.zim', archive_title: 'Survival Library' }),
    chunk({ source: '/zim/survival.zim', archive_title: 'Survival Library' }),
    chunk({ source: '/zim/survival.zim', archive_title: 'Survival Library' }),
  ])
  assert.equal(sources.length, 1)
  assert.equal(sources[0].title, 'Survival Library')
})

check('dedupes on path, not title, so same-named archives stay distinct', () => {
  const sources = buildCitations([
    chunk({ source: '/zim/wikipedia_2024.zim', archive_title: 'Wikipedia' }),
    chunk({ source: '/zim/wikipedia_2026.zim', archive_title: 'Wikipedia' }),
  ])
  assert.deepEqual(
    sources.map((s) => s.source),
    ['/zim/wikipedia_2024.zim', '/zim/wikipedia_2026.zim']
  )
})

check('prefers the archive title over per-article titles', () => {
  const [source] = buildCitations([
    chunk({
      source: '/zim/ifixit.zim',
      archive_title: 'iFixit Repair Guides',
      full_title: 'Replacing a MacBook battery',
      article_title: 'MacBook battery',
    }),
  ])
  assert.equal(source.title, 'iFixit Repair Guides')
})

check('falls back through full_title then article_title', () => {
  assert.equal(
    buildCitations([chunk({ source: '/a.zim', full_title: 'Full', article_title: 'Article' })])[0].title,
    'Full'
  )
  assert.equal(buildCitations([chunk({ source: '/b.zim', article_title: 'Article' })])[0].title, 'Article')
})

check('names an untitled upload by its filename', () => {
  const [source] = buildCitations([chunk({ source: '/kb_uploads/well drilling notes.pdf' })])
  assert.equal(source.title, 'well drilling notes.pdf')
  assert.equal(source.source, '/kb_uploads/well drilling notes.pdf')
})

check('carries the archive date when one is known', () => {
  const [withDate] = buildCitations([
    chunk({ source: '/zim/wiki.zim', archive_title: 'Wikipedia', archive_date: '2026-06' }),
  ])
  assert.equal(withDate.date, '2026-06')
  const [withoutDate] = buildCitations([chunk({ source: '/zim/wiki.zim', archive_title: 'Wikipedia' })])
  assert.equal(withoutDate.date, undefined)
})

check('skips a chunk with neither a path nor a title', () => {
  // "Unknown source" is not a citation; it makes the answer look sourced.
  assert.deepEqual(buildCitations([chunk({ chunk_index: 3 })]), [])
})

check('returns nothing when no context was injected', () => {
  assert.deepEqual(buildCitations([]), [])
})

check('preserves injection order', () => {
  const sources = buildCitations([
    chunk({ source: '/zim/b.zim', archive_title: 'Second' }),
    chunk({ source: '/zim/a.zim', archive_title: 'First' }),
  ])
  assert.deepEqual(
    sources.map((s) => s.title),
    ['Second', 'First']
  )
})

// ── Fork additions ──
check('a non-string source is ignored rather than split like a path', () => {
  const [source] = buildCitations([chunk({ source: 42, archive_title: 'Numbers' })])
  assert.equal(source.title, 'Numbers')
  assert.equal(source.source, undefined)
})

check('what is stored reads back as what was built', () => {
  const built = buildCitations([
    chunk({ source: '/zim/wiki.zim', archive_title: 'Wikipedia', archive_date: '2026-06' }),
    chunk({ source: '/kb_uploads/notes.pdf' }),
  ])
  // The controller stores exactly JSON.stringify(sources).
  assert.deepEqual(parseStoredSources(JSON.stringify(built)), built)
})

check('a message with no stored sources has none', () => {
  assert.equal(parseStoredSources(null), undefined)
  assert.equal(parseStoredSources(undefined), undefined)
  assert.equal(parseStoredSources(''), undefined)
  assert.equal(parseStoredSources('[]'), undefined)
})

check('a malformed stored value cannot take the conversation down with it', () => {
  // Upstream JSON.parses the column bare in the session loader, so one bad
  // row fails the whole conversation's load.
  for (const raw of ['{not json', '"a string"', '{"title":"object, not array"}', '42', 'null']) {
    assert.equal(parseStoredSources(raw), undefined, raw)
  }
})

check('stored entries without a title are dropped, the rest kept', () => {
  const read = parseStoredSources(
    JSON.stringify([{ title: 'Kept', date: '2026-01' }, { source: '/no/title.zim' }, null, { title: '' }])
  )
  assert.deepEqual(read, [{ title: 'Kept', date: '2026-01' }])
})

console.log(`\n${passed} passed`)
