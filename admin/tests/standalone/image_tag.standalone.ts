/**
 * Standalone test for the Supply Depot version-display helper.
 *
 *   node --experimental-strip-types tests/standalone/image_tag.standalone.ts
 *
 * Regression guard for the digest-as-version bug: digest-pinned images (and
 * registry-port refs) must never render a raw 64-char digest in the Version
 * column. Shared by settings/apps.tsx + SupplyDepotCard.
 */
import assert from 'node:assert/strict'
import { extractTag } from '../../inertia/lib/imageTag.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('empty image → empty string', () => assert.equal(extractTag(''), ''))
check('plain image with no tag → latest', () => assert.equal(extractTag('grocy/grocy'), 'latest'))
check('semver tag', () => assert.equal(extractTag('ollama/ollama:0.15.2'), '0.15.2'))
check('v-prefixed tag', () => assert.equal(extractTag('meshtastic/web:v2.7.1'), 'v2.7.1'))
check('registry with port does not mistake the port for the tag', () =>
  assert.equal(extractTag('registry.local:5000/foo:1.2.3'), '1.2.3'))
check('registry with port, no tag → latest', () =>
  assert.equal(extractTag('registry.local:5000/foo'), 'latest'))

// the bug: digest-pinned images
const digest = 'c01e9fa0f1323490f17d0dd34d9341dcaabbccddeeff00112233445566778899'
check('digest pin (@sha256:) collapses to a short 12-char id, not 64 chars', () => {
  const out = extractTag(`linuxserver/grocy@sha256:${digest}`)
  assert.equal(out, digest.slice(0, 12))
  assert.ok(out.length === 12)
})
check('tag PLUS digest prefers the readable tag', () =>
  assert.equal(extractTag(`vaultwarden/server:1.30.1@sha256:${digest}`), '1.30.1'))
check('digest-shaped tag (no @) is also shortened, never 64 chars', () => {
  const out = extractTag(`pdf/tools:${digest}`)
  assert.equal(out, digest.slice(0, 12))
})
check('never returns a 64-char hex string for any digest form', () => {
  for (const img of [`a@sha256:${digest}`, `a:${digest}`, `r.io:5000/a@sha256:${digest}`]) {
    assert.ok(extractTag(img).length <= 12, `leaked long digest for ${img}`)
  }
})

console.log(`\n${passed} passed`)
