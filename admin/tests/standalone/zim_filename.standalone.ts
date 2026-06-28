/**
 * Standalone test for the Wikipedia-cleanup variant matcher (#884).
 *
 * `zimFilenameStem` / `findReplacedWikipediaFiles` are pure, so they run under
 * `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/zim_filename.standalone.ts
 *
 * The bug: post-download cleanup deleted every `wikipedia_en_*` file except the
 * one just installed, so finishing a general-Wikipedia download silently wiped
 * the curated medicine/simple/wikivoyage tiers a preparedness user installed.
 */
import assert from 'node:assert/strict'
import { zimFilenameStem, findReplacedWikipediaFiles } from '../../app/utils/zim_filename.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// --- zimFilenameStem ---
check('strips a _YYYY-MM.zim date suffix', () => {
  assert.equal(zimFilenameStem('wikipedia_en_all_maxi_2026-02.zim'), 'wikipedia_en_all_maxi')
})

check('strips a _YYYY-MM-DD.zim date suffix', () => {
  assert.equal(zimFilenameStem('wikipedia_en_all_maxi_2026-02-15.zim'), 'wikipedia_en_all_maxi')
})

check('leaves a name with no date suffix unchanged', () => {
  assert.equal(zimFilenameStem('wikipedia_en_all_maxi'), 'wikipedia_en_all_maxi')
})

check('distinct corpora keep distinct stems', () => {
  assert.notEqual(
    zimFilenameStem('wikipedia_en_all_maxi_2026-02.zim'),
    zimFilenameStem('wikipedia_en_medicine_maxi_2026-01.zim')
  )
})

// --- findReplacedWikipediaFiles ---
const CURRENT = 'wikipedia_en_all_maxi_2026-02.zim'
const EXISTING = [
  'wikipedia_en_all_maxi_2026-02.zim', // the current download itself
  'wikipedia_en_all_maxi_2025-01.zim', // a true prior version of the SAME variant
  'wikipedia_en_medicine_maxi_2026-01.zim', // curated medicine tier — MUST survive
  'wikipedia_en_simple_all_2026-01.zim', // curated simple tier — MUST survive
  'devdocs_en_bash_2026-01.zim', // not a wikipedia corpus
]

check('deletes a true prior version of the same variant', () => {
  assert.deepEqual(findReplacedWikipediaFiles(CURRENT, EXISTING), [
    'wikipedia_en_all_maxi_2025-01.zim',
  ])
})

check('#884 repro: does NOT delete the curated medicine tier', () => {
  assert.ok(!findReplacedWikipediaFiles(CURRENT, EXISTING).includes('wikipedia_en_medicine_maxi_2026-01.zim'))
})

check('#884 repro: does NOT delete the curated simple tier', () => {
  assert.ok(!findReplacedWikipediaFiles(CURRENT, EXISTING).includes('wikipedia_en_simple_all_2026-01.zim'))
})

check('never deletes the current download itself', () => {
  assert.ok(!findReplacedWikipediaFiles(CURRENT, EXISTING).includes(CURRENT))
})

check('ignores non-wikipedia files entirely', () => {
  assert.ok(!findReplacedWikipediaFiles(CURRENT, EXISTING).includes('devdocs_en_bash_2026-01.zim'))
})

check('returns nothing when no prior version of the variant is present', () => {
  assert.deepEqual(
    findReplacedWikipediaFiles('wikipedia_en_climate_change_2026-01.zim', EXISTING),
    []
  )
})

console.log(`\n${passed} passed`)
