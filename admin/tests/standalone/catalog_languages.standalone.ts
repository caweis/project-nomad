/**
 * Standalone checks for the Kiwix catalog's language list.
 *
 *   node --experimental-strip-types tests/standalone/catalog_languages.standalone.ts
 *
 * Content Explorer hardcoded English, about 1,300 of the catalog's ~10,900
 * books. The picker that replaces it is only as good as this parse: an option
 * it lets through that the list endpoint then refuses, or that has no books,
 * is a dead end for exactly the reader the picker is for.
 *
 * Runs real OPDS XML through the same fast-xml-parser options ZimService uses,
 * so the field names are checked as parsed, not as imagined. Needs
 * node_modules, as the validator checks do.
 */
import assert from 'node:assert/strict'
import { XMLParser } from 'fast-xml-parser'
import {
  CATALOG_LANGUAGE_PATTERN,
  parseCatalogLanguages,
} from '../../app/utils/catalog_languages.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const parse = (xml: string) =>
  parseCatalogLanguages(
    new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text' }).parse(xml)
  )

const entry = (code: string, title: string, count: string) => `
  <entry>
    <title>${title}</title>
    <dc:language>${code}</dc:language>
    <thr:count>${count}</thr:count>
    <link rel="subsection" href="/catalog/v2/entries?lang=${code}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
    <updated>2026-09-01T00:00:00Z</updated>
    <id>12345678-${code}</id>
  </entry>`

const feed = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="https://specs.opds.io/opds-1.2"
      xmlns:thr="http://purl.org/syndication/thread/1.0">
  <id>languages-feed</id>
  <title>List of languages</title>
  <updated>2026-09-01T00:00:00Z</updated>
  ${entries.join('\n')}
</feed>`

check('reads code, endonym and book count, most books first', () => {
  const languages = parse(
    feed(entry('fra', 'français', '512'), entry('eng', 'English', '1301'), entry('zho', '中文', '87'))
  )
  assert.deepEqual(languages, [
    { code: 'eng', label: 'English', book_count: 1301 },
    { code: 'fra', label: 'français', book_count: 512 },
    { code: 'zho', label: '中文', book_count: 87 },
  ])
})

check('a feed with a single language still parses as a list', () => {
  // fast-xml-parser collapses a lone <entry> to an object, not an array.
  assert.deepEqual(parse(feed(entry('deu', 'Deutsch', '42'))), [
    { code: 'deu', label: 'Deutsch', book_count: 42 },
  ])
})

check('a language with no books behind it is not offered', () => {
  const languages = parse(feed(entry('eng', 'English', '10'), entry('xyz', 'Empty', '0')))
  assert.deepEqual(
    languages.map((l) => l.code),
    ['eng']
  )
})

check('a code the list endpoint would refuse is not offered', () => {
  // Picking it would only earn a 422 from listRemoteZimValidator.
  const languages = parse(
    feed(entry('eng', 'English', '10'), entry('en-GB', 'British', '3'), entry('eng,fra', 'Mixed', '2'))
  )
  assert.deepEqual(
    languages.map((l) => l.code),
    ['eng']
  )
  for (const l of languages) assert.ok(CATALOG_LANGUAGE_PATTERN.test(l.code))
})

check('a catalog entry literally coded "all" cannot shadow the no-filter option', () => {
  assert.deepEqual(parse(feed(entry('all', 'Everything', '9'))), [])
})

check('"nan" is a language, not a number', () => {
  // ISO 639-3 `nan` is Min Nan Chinese. The parser converts numeric text to
  // numbers; if it ever turned this into NaN the language would vanish silently.
  assert.deepEqual(parse(feed(entry('nan', 'Bân-lâm-gú', '12'))), [
    { code: 'nan', label: 'Bân-lâm-gú', book_count: 12 },
  ])
})

check('a missing title falls back to the code rather than a blank option', () => {
  const xml = feed(`<entry><dc:language>ita</dc:language><thr:count>5</thr:count></entry>`)
  assert.deepEqual(parse(xml), [{ code: 'ita', label: 'ita', book_count: 5 }])
})

check('an empty or malformed feed yields no languages, not a throw', () => {
  assert.deepEqual(parse(feed()), [])
  assert.deepEqual(parseCatalogLanguages(null), [])
  assert.deepEqual(parseCatalogLanguages({ feed: { entry: 'not an entry' } }), [])
})

console.log(`\n${passed} passed`)
