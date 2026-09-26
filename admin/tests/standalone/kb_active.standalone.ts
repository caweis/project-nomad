/**
 * Standalone checks for the knowledge base's per-file search switch
 * (upstream f1624228, #1286): the search filter, reading the stored flag, the
 * request rules, and the messages.
 *
 *   node --experimental-strip-types tests/standalone/kb_active.standalone.ts
 *
 * Upstream's own tests cover its grouped table layout, which this fork does
 * not use. These cover the parts both share, plus the two places the fork
 * differs: a bulk switch for a named collection only, and a filter checked
 * against payloads written before the field existed.
 */
import assert from 'node:assert/strict'
import {
  collectionActiveMessage,
  effectiveActive,
  fileActiveMessage,
  parseCollectionActiveInput,
  parseFileActiveInput,
  searchFilter,
} from '../../app/utils/kb_active.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// Qdrant's semantics for the conditions searchFilter uses: `match` on a keyword
// or bool value. A point whose payload lacks the key matches no `match`
// condition, so it passes a must_not and fails a must.
type Condition = { key: string; match: { value: unknown } }
function passes(
  filter: { must?: Condition[]; must_not?: Condition[] },
  payload: Record<string, unknown>
): boolean {
  const matches = (c: Condition) => c.key in payload && payload[c.key] === c.match.value
  return (filter.must ?? []).every(matches) && !(filter.must_not ?? []).some(matches)
}

// ── The search filter ──
check('search leaves out a file switched off, and nothing else', () => {
  const filter = searchFilter()
  assert.equal(passes(filter, { source: 'a', active: true }), true)
  assert.equal(passes(filter, { source: 'a', active: false }), false)
})

check('a point written before the switch existed is still found', () => {
  // The denylist is what makes this true. An allowlist (must: active == true)
  // would hide every older point until the backfill reached it.
  assert.equal(passes(searchFilter(), { source: 'old.zim' }), true)
})

check('a collection search keeps to the collection and still leaves out what is off', () => {
  const filter = searchFilter('medical')
  assert.equal(passes(filter, { collection: 'medical', active: true }), true)
  assert.equal(passes(filter, { collection: 'medical' }), true)
  assert.equal(passes(filter, { collection: 'medical', active: false }), false)
  assert.equal(passes(filter, { collection: 'radio', active: true }), false)
  assert.equal(passes(filter, { active: true }), false)
})

check('without a collection there is no must clause at all', () => {
  assert.deepEqual(Object.keys(searchFilter()), ['must_not'])
  assert.deepEqual(Object.keys(searchFilter('')), ['must_not'])
})

// ── The stored flag ──
check("MySQL's 1 and 0 become true and false, and no value means on", () => {
  assert.equal(effectiveActive(1), true)
  assert.equal(effectiveActive(0), false)
  assert.equal(effectiveActive(true), true)
  assert.equal(effectiveActive(false), false)
  // No row, or a row read before the migration: files start in search.
  assert.equal(effectiveActive(null), true)
  assert.equal(effectiveActive(undefined), true)
})

// ── Requests ──
check('a single-file switch needs a source and a real boolean', () => {
  assert.deepEqual(parseFileActiveInput('/app/storage/zim/wiki.zim', false), {
    ok: true,
    value: { source: '/app/storage/zim/wiki.zim', active: false },
  })
  for (const source of [null, undefined, '', '   ', ['a'], 7]) {
    assert.equal(parseFileActiveInput(source, true).ok, false, JSON.stringify(source))
  }
})

check('"true" as a string is refused, which keeps cross-site forms out', () => {
  // An HTML form on another site can only send strings. Coercing these would
  // put this write within reach of one (upstream f1624228).
  for (const active of ['true', 'false', 1, 0, null, undefined, 'on']) {
    assert.equal(parseFileActiveInput('/a', active).ok, false, JSON.stringify(active))
    assert.equal(parseCollectionActiveInput('medical', active).ok, false, JSON.stringify(active))
  }
})

check('a collection switch takes a name, checked before anything trims it', () => {
  assert.deepEqual(parseCollectionActiveInput('medical', true), {
    ok: true,
    value: { collection: 'medical', active: true },
  })
  // collection[]=a from a form arrives as an array; trimming that threw a 500
  // upstream before its type check was moved ahead of sanitizing.
  assert.equal(parseCollectionActiveInput(['medical'], true).ok, false)
  assert.equal(parseCollectionActiveInput({ name: 'medical' }, true).ok, false)
  assert.equal(parseCollectionActiveInput('   ', true).ok, false)
})

check('Uncategorized is not a collection the bulk switch will take', () => {
  // Upstream sends null for it, and on the server that reaches every point with
  // no collection: every ZIM and NOMAD's own help pages, not just the uploads
  // its screen lists under that heading.
  const result = parseCollectionActiveInput(null, false)
  assert.equal(result.ok, false)
})

// ── Messages ──
check('switching one file names it, and says nothing was deleted', () => {
  assert.equal(fileActiveMessage('first-aid.pdf', true), '"first-aid.pdf" will be used in answers.')
  const off = fileActiveMessage('first-aid.pdf', false)
  assert.match(off, /^"first-aid\.pdf" won't be used in answers\./)
  assert.match(off, /Nothing was deleted/)
})

check('a collection switch counts only the files that changed', () => {
  assert.equal(
    collectionActiveMessage('medical', false, 9),
    `9 files in "medical" won't be used in answers.`
  )
  assert.equal(
    collectionActiveMessage('medical', true, 1),
    '1 file in "medical" will be used in answers.'
  )
  assert.equal(
    collectionActiveMessage('medical', false, 0),
    'Every file in "medical" was already switched off.'
  )
  assert.equal(
    collectionActiveMessage('medical', true, 0),
    'Every file in "medical" was already switched on.'
  )
})

console.log(`\n${passed} checks passed`)
