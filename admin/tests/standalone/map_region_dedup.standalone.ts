/**
 * Standalone test for the map-source region dedup (#634 / map blanking).
 *
 * `compareMapVersions` and `pickNewestPerRegion` are pure, so they run under
 * `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/map_region_dedup.standalone.ts
 */
import assert from 'node:assert/strict'
import { compareMapVersions, pickNewestPerRegion } from '../../app/utils/map_region_dedup.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── compareMapVersions ──
check('a dated version beats an undated legacy file', () => {
  assert.equal(compareMapVersions('2025-12', null) > 0, true)
  assert.equal(compareMapVersions(null, '2025-12') < 0, true)
})
check('the later YYYY-MM wins lexicographically', () => {
  assert.equal(compareMapVersions('2025-12', '2025-11') > 0, true)
})
check('equal versions compare equal', () => {
  assert.equal(compareMapVersions('2025-12', '2025-12'), 0)
  assert.equal(compareMapVersions(null, null), 0)
})

// ── pickNewestPerRegion — the load-bearing dedup ──
check('keeps exactly one file per region, choosing the newest', () => {
  const kept = pickNewestPerRegion([
    { name: 'washington.pmtiles', regionName: 'washington', version: null },
    { name: 'washington_2025-12.pmtiles', regionName: 'washington', version: '2025-12' },
    { name: 'alaska_2025-11.pmtiles', regionName: 'alaska', version: '2025-11' },
    { name: 'alaska_2025-12.pmtiles', regionName: 'alaska', version: '2025-12' },
  ])
  assert.equal(kept.length, 2)
  const byRegion = Object.fromEntries(kept.map((e) => [e.regionName, e.name]))
  assert.equal(byRegion.washington, 'washington_2025-12.pmtiles') // dated beats undated legacy
  assert.equal(byRegion.alaska, 'alaska_2025-12.pmtiles') // later YYYY-MM wins
})

// this is the exact property whose absence blanks the whole map
check('no two surviving regions share a source key', () => {
  const kept = pickNewestPerRegion([
    { name: 'a_2025-01.pmtiles', regionName: 'a', version: '2025-01' },
    { name: 'a_2025-02.pmtiles', regionName: 'a', version: '2025-02' },
  ])
  const keys = kept.map((e) => e.regionName)
  assert.equal(new Set(keys).size, keys.length)
})

check('a single file per region is passed through unchanged', () => {
  const kept = pickNewestPerRegion([
    { name: 'texas_2025-05.pmtiles', regionName: 'texas', version: '2025-05' },
  ])
  assert.equal(kept.length, 1)
  assert.equal(kept[0].name, 'texas_2025-05.pmtiles')
})

console.log(`\n${passed} passed`)
