/**
 * Standalone test for the pure storage-bind prefix rewrite (#938).
 *
 * `DockerService._applyHostStorageRoot` resolves the admin's real host storage
 * root (a Docker inspect — mini-gated, not run here) and defers the actual
 * prefix swap to `rewriteStorageBinds` in `app/services/storage_binds.ts`. Only
 * the pure swap is exercised here under `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/storage_binds.standalone.ts
 *
 * Ported from upstream commit 32e0694's _applyHostStorageRoot logic.
 */
import assert from 'node:assert/strict'
import { rewriteStorageBinds } from '../../app/services/storage_binds.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const SEEDED = '/opt/project-nomad/storage'
const ROOT = '/mnt/big/storage'

// ── no-op when the resolved root matches the seeded prefix (common case) ──────
check('returns the binds unchanged when root === seededRoot', () => {
  const binds = [`${SEEDED}/zim:/data`, `${SEEDED}/ollama:/root/.ollama`]
  const out = rewriteStorageBinds(binds, SEEDED, SEEDED)
  assert.deepEqual(out, binds)
})

// ── rewrite the host prefix when the root diverges ────────────────────────────
check('rewrites a bind whose host source equals the seeded root subtree', () => {
  const out = rewriteStorageBinds([`${SEEDED}/zim:/data`], ROOT, SEEDED)
  assert.deepEqual(out, [`${ROOT}/zim:/data`])
})

check('rewrites every storage bind in the array', () => {
  const binds = [
    `${SEEDED}/zim:/data`,
    `${SEEDED}/ollama:/root/.ollama`,
    `${SEEDED}/qdrant:/qdrant/storage`,
  ]
  const out = rewriteStorageBinds(binds, ROOT, SEEDED)
  assert.deepEqual(out, [
    `${ROOT}/zim:/data`,
    `${ROOT}/ollama:/root/.ollama`,
    `${ROOT}/qdrant:/qdrant/storage`,
  ])
})

check('rewrites a bind whose host source equals the seeded root exactly (no trailing path)', () => {
  const out = rewriteStorageBinds([`${SEEDED}:/app/storage`], ROOT, SEEDED)
  assert.deepEqual(out, [`${ROOT}:/app/storage`])
})

check('preserves a trailing :ro (or other) mount option', () => {
  const out = rewriteStorageBinds([`${SEEDED}/meshcore-web/certs:/certs:ro`], ROOT, SEEDED)
  assert.deepEqual(out, [`${ROOT}/meshcore-web/certs:/certs:ro`])
})

// ── leave non-storage binds alone ─────────────────────────────────────────────
check('leaves a bind whose host source is outside the seeded root untouched', () => {
  const out = rewriteStorageBinds(['/var/run/docker.sock:/var/run/docker.sock'], ROOT, SEEDED)
  assert.deepEqual(out, ['/var/run/docker.sock:/var/run/docker.sock'])
})

check('does not rewrite a sibling path that merely shares the prefix string', () => {
  // "/opt/project-nomad/storage-backup" is NOT under "/opt/project-nomad/storage/"
  const sibling = `${SEEDED}-backup/data:/data`
  const out = rewriteStorageBinds([sibling], ROOT, SEEDED)
  assert.deepEqual(out, [sibling])
})

check('rewrites only the storage binds in a mixed array', () => {
  const binds = [
    `${SEEDED}/zim:/data`,
    '/var/run/docker.sock:/var/run/docker.sock',
    `${SEEDED}-backup/x:/x`,
  ]
  const out = rewriteStorageBinds(binds, ROOT, SEEDED)
  assert.deepEqual(out, [
    `${ROOT}/zim:/data`,
    '/var/run/docker.sock:/var/run/docker.sock',
    `${SEEDED}-backup/x:/x`,
  ])
})

// ── degenerate inputs ─────────────────────────────────────────────────────────
check('returns undefined/empty inputs unchanged', () => {
  assert.equal(rewriteStorageBinds(undefined, ROOT, SEEDED), undefined)
  assert.deepEqual(rewriteStorageBinds([], ROOT, SEEDED), [])
})

check('leaves a malformed bind with no colon untouched', () => {
  const out = rewriteStorageBinds([`${SEEDED}-nope`], ROOT, SEEDED)
  assert.deepEqual(out, [`${SEEDED}-nope`])
})

// ── macOS-fork prefix (NOMAD_DIR_PLACEHOLDER substituted to an install dir) ────
check('works with a macOS-style seeded prefix under the user home', () => {
  const macSeeded = '/Users/alice/.project-nomad/storage'
  const macRoot = '/Volumes/External/nomad/storage'
  const out = rewriteStorageBinds([`${macSeeded}/zim:/data`], macRoot, macSeeded)
  assert.deepEqual(out, [`${macRoot}/zim:/data`])
})

console.log(`\n${passed} checks passed`)
