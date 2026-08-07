/**
 * Standalone test for the Calibre-Web provisioning decision layer.
 *
 * Pure, so it runs under `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/calibre_provision_decision.standalone.ts
 */
import assert from 'node:assert/strict'
import { decideProvisionSteps } from '../../app/utils/calibre_provision_decision.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('fresh install: seed library, materialize app.db, point at /books', () => {
  assert.deepEqual(
    decideProvisionSteps({ libraryDbExists: false, appDbExists: false, configCalibreDir: null }),
    ['seed-library-db', 'materialize-app-db', 'point-library']
  )
})

check('installed but stranded at the wizard: seed + point, never rebuild app.db', () => {
  // app.db exists (created by the app's own first boot, users seeded) but the
  // wizard was never completed — the pre-0.2.760 install state.
  assert.deepEqual(
    decideProvisionSteps({ libraryDbExists: false, appDbExists: true, configCalibreDir: null }),
    ['seed-library-db', 'point-library']
  )
})

check('library seeded on a prior partial run: only point', () => {
  assert.deepEqual(
    decideProvisionSteps({ libraryDbExists: true, appDbExists: true, configCalibreDir: null }),
    ['point-library']
  )
})

check('library present, app.db missing: materialize + point, no re-seed', () => {
  assert.deepEqual(
    decideProvisionSteps({ libraryDbExists: true, appDbExists: false, configCalibreDir: null }),
    ['materialize-app-db', 'point-library']
  )
})

check('HANDS OFF a configured install, even with our /books value', () => {
  assert.deepEqual(
    decideProvisionSteps({ libraryDbExists: true, appDbExists: true, configCalibreDir: '/books' }),
    []
  )
})

check('HANDS OFF a user-configured library elsewhere, even with no metadata.db seeded', () => {
  assert.deepEqual(
    decideProvisionSteps({
      libraryDbExists: false,
      appDbExists: true,
      configCalibreDir: '/config/mylibrary',
    }),
    []
  )
})

check('empty-string config dir counts as unconfigured', () => {
  assert.deepEqual(
    decideProvisionSteps({ libraryDbExists: true, appDbExists: true, configCalibreDir: null }),
    ['point-library']
  )
})

console.log(`\n${passed} passed`)
