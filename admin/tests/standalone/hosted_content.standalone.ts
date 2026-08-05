/**
 * Standalone test for the gated-content predicate (upstream #1172 port).
 *
 *   node --experimental-strip-types tests/standalone/hosted_content.standalone.ts
 *
 * hosted_content.ts is importable here because its only import is type-only
 * (erased by strip-types). The env-reading side (hosted_content_auth.ts) pulls
 * in #start/env and cannot run under this harness — by design; see the module
 * doc comments.
 */
import assert from 'node:assert/strict'
import { isGatedResource, NOMAD_APP_KEY_AUTH } from '../../app/utils/hosted_content.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check("auth: 'nomad_app_key' is gated", () => {
  assert.equal(isGatedResource({ auth: 'nomad_app_key' }), true)
})

check('absent auth is not gated (every existing manifest entry)', () => {
  assert.equal(isGatedResource({}), false)
})

check('the exported scheme constant matches the manifest literal', () => {
  assert.equal(NOMAD_APP_KEY_AUTH, 'nomad_app_key')
})

console.log(`\nhosted_content: ${passed}/3 checks passed`)
