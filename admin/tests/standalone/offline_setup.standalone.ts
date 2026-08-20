/**
 * Standalone test for the Easy Setup offline rules.
 *
 * Pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/offline_setup.standalone.ts
 */
import assert from 'node:assert/strict'
import {
  canCompleteSetupOffline,
  describeOfflineBlockers,
  offlineBlockers,
  type WizardSelections,
} from '../../inertia/lib/offline_setup.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const EMPTY: WizardSelections = {
  services: [],
  mapCollections: [],
  categoryTierCount: 0,
  aiModels: [],
  wikipediaOptionId: null,
  drugReference: false,
}

check('nothing selected finishes offline', () => {
  assert.deepEqual(offlineBlockers(EMPTY), [])
  assert.equal(canCompleteSetupOffline(EMPTY), true)
})

// the regression: the wizard used to refuse to finish offline no matter what,
// so a host with no connection could not complete setup at all.
check('opting out of Wikipedia still finishes offline', () => {
  const s = { ...EMPTY, wikipediaOptionId: 'none' }
  assert.deepEqual(offlineBlockers(s), [])
  assert.equal(canCompleteSetupOffline(s), true)
})

check('a real Wikipedia pick blocks offline finish', () => {
  const s = { ...EMPTY, wikipediaOptionId: 'wikipedia_en_all_maxi' }
  assert.deepEqual(offlineBlockers(s), ['Wikipedia to download'])
  assert.equal(canCompleteSetupOffline(s), false)
})

check('each download-bearing selection blocks on its own', () => {
  assert.deepEqual(offlineBlockers({ ...EMPTY, services: ['nomad_kiwix'] }), ['1 app to install'])
  assert.deepEqual(offlineBlockers({ ...EMPTY, mapCollections: ['us-tx'] }), ['1 map to download'])
  assert.deepEqual(offlineBlockers({ ...EMPTY, categoryTierCount: 2 }), [
    '2 content selections to download',
  ])
  assert.deepEqual(offlineBlockers({ ...EMPTY, aiModels: ['llama3.2'] }), [
    '1 AI model to download',
  ])
  assert.deepEqual(offlineBlockers({ ...EMPTY, drugReference: true }), [
    'the drug reference to download',
  ])
})

check('plurals read correctly', () => {
  assert.deepEqual(offlineBlockers({ ...EMPTY, services: ['a', 'b'] }), ['2 apps to install'])
  assert.deepEqual(offlineBlockers({ ...EMPTY, categoryTierCount: 1 }), [
    '1 content selection to download',
  ])
})

check('every blocker is reported, not just the first', () => {
  const s: WizardSelections = {
    services: ['nomad_kiwix'],
    mapCollections: ['us-tx'],
    categoryTierCount: 1,
    aiModels: ['llama3.2'],
    wikipediaOptionId: 'wikipedia_en_all_mini',
    drugReference: true,
  }
  assert.equal(offlineBlockers(s).length, 6)
  assert.equal(canCompleteSetupOffline(s), false)
})

check('describeOfflineBlockers is empty when nothing blocks', () => {
  assert.equal(describeOfflineBlockers([]), '')
})

check('describeOfflineBlockers reads as a sentence', () => {
  assert.equal(
    describeOfflineBlockers(['1 app to install']),
    "No internet connection, so setup can't finish with 1 app to install. Clear those to finish now, or connect and try again."
  )
  assert.match(
    describeOfflineBlockers(['1 app to install', '2 maps to download']),
    /1 app to install and 2 maps to download/
  )
  assert.match(
    describeOfflineBlockers(['a', 'b', 'c']),
    /a, b and c/
  )
})

console.log(`\n${passed} passed`)
