/**
 * Standalone test for the curated-ZIM reconcile skip predicate (#774).
 *
 * `isManagedWikipediaFile` is pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/wikipedia_reconcile.standalone.ts
 */
import assert from 'node:assert/strict'
import { isManagedWikipediaFile } from '../../app/utils/wikipedia_reconcile.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const MANAGED = 'wikipedia_en_all_maxi_2024-01.zim'
const MEDICINE_TIER = 'wikipedia_en_medicine_maxi_2026-01.zim'

// the bug: a curated medicine-tier ZIM was wiped on every restart by the blanket prefix skip
check('the curated medicine-tier ZIM is NOT skipped, so it reconciles and keeps its row', () => {
  assert.equal(isManagedWikipediaFile(MEDICINE_TIER, MANAGED), false)
})

check('the user-selected general-Wikipedia file IS skipped', () => {
  assert.equal(isManagedWikipediaFile(MANAGED, MANAGED), true)
})

check('nothing is skipped when no Wikipedia selection exists', () => {
  assert.equal(isManagedWikipediaFile(MEDICINE_TIER, null), false)
})

// regression guard: the medicine tier shares the prefix the old blanket skip matched
check('the medicine tier shares the wikipedia_en_ prefix the old code wrongly skipped', () => {
  assert.equal(MEDICINE_TIER.startsWith('wikipedia_en_'), true)
})

console.log(`\n${passed} passed`)
