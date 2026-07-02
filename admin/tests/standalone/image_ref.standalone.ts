/**
 * Standalone test for the update image-ref builder.
 *
 *   node --experimental-strip-types tests/standalone/image_ref.standalone.ts
 *
 * The disk pre-flight and the actual pull must agree on the ref, or the check
 * sizes a different image than the one that lands. Locks the "swap the tag,
 * keep the repo" behavior (including the no-tag case).
 */
import assert from 'node:assert/strict'
import { buildUpdatedImageRef } from '../../app/utils/image_ref.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('replaces an existing tag', () =>
  assert.equal(buildUpdatedImageRef('ollama/ollama:0.23.1', '0.23.2'), 'ollama/ollama:0.23.2'))
check('keeps a registry/owner/name path', () =>
  assert.equal(buildUpdatedImageRef('ghcr.io/owner/app:v1', 'v2'), 'ghcr.io/owner/app:v2'))
check('adds a tag when none is present', () =>
  assert.equal(buildUpdatedImageRef('busybox', 'latest'), 'busybox:latest'))
check('library image with tag', () =>
  assert.equal(buildUpdatedImageRef('docker.io/library/nginx:1.0', '1.2'), 'docker.io/library/nginx:1.2'))

console.log(`\n${passed} passed`)
