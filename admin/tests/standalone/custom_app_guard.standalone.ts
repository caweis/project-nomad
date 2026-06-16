/**
 * Standalone gate test for the custom-app security guard.
 *
 * Upstream ships this as a Japa unit spec (admin/tests/unit/custom_app_guard.spec.ts),
 * but Japa cannot boot locally without MySQL/Redis. This file ports the same cases to a
 * pure `node --experimental-strip-types` runner that exercises the guard directly. Run:
 *   node --experimental-strip-types tests/standalone/custom_app_guard.standalone.ts
 *
 * Ported from `git show crosstalk/feat/supply-depot-meshcore-web:admin/tests/unit/custom_app_guard.spec.ts`.
 * Cases below mirror that spec one-for-one; the assertions are kept identical (node:assert/strict).
 *
 * All bind-mount cases assume the default storage root (/opt/project-nomad/storage),
 * i.e. NOMAD_STORAGE_PATH unset — asserted in the first check so the rest are sound.
 */
import assert from 'node:assert/strict'
import {
  evaluateBindMounts,
  evaluateImageReference,
  evaluateCustomApp,
  getStorageRoot,
  DEFAULT_MEMORY_MB,
  DEFAULT_CPUS,
} from '../../app/services/custom_app_guard.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── Default storage root (the precondition the bind-mount cases rely on) ───────
check('getStorageRoot defaults to /opt/project-nomad/storage when NOMAD_STORAGE_PATH is unset', () => {
  assert.equal(process.env.NOMAD_STORAGE_PATH ?? '', '')
  assert.equal(getStorageRoot(), '/opt/project-nomad/storage')
})

// ── Bind mounts ───────────────────────────────────────────────────────────────
check('evaluateBindMounts hard-blocks the Docker socket', () => {
  const { blocked } = evaluateBindMounts([
    { host_path: '/var/run/docker.sock', container_path: '/var/run/docker.sock' },
  ])
  assert.equal(blocked.length, 1)
})

check('evaluateBindMounts hard-blocks core system directories', () => {
  for (const dir of ['/etc', '/proc/foo', '/sys', '/boot', '/dev/sda']) {
    const { blocked } = evaluateBindMounts([{ host_path: dir, container_path: '/data' }])
    assert.equal(blocked.length, 1, `${dir} should be blocked`)
  }
})

check('evaluateBindMounts hard-blocks mounting at or above the install tree', () => {
  for (const dir of ['/', '/opt', '/opt/project-nomad']) {
    const { blocked } = evaluateBindMounts([{ host_path: dir, container_path: '/data' }])
    assert.equal(blocked.length, 1, `${dir} should be blocked`)
  }
})

check('evaluateBindMounts allows paths under the storage root without warning', () => {
  const { blocked, warnings } = evaluateBindMounts([
    { host_path: '/opt/project-nomad/storage/myapp', container_path: '/data' },
  ])
  assert.equal(blocked.length, 0)
  assert.equal(warnings.length, 0)
})

check('evaluateBindMounts warns (but allows) paths outside the storage root', () => {
  const { blocked, warnings } = evaluateBindMounts([
    { host_path: '/home/user/data', container_path: '/data' },
  ])
  assert.equal(blocked.length, 0)
  assert.equal(warnings.length, 1)
})

check('evaluateBindMounts resolves .. before matching (no traversal escape)', () => {
  // Normalizes to /etc, which must still be blocked despite the dressing-up.
  const { blocked } = evaluateBindMounts([
    { host_path: '/srv/../etc/shadow', container_path: '/data' },
  ])
  assert.equal(blocked.length, 1)
})

check('evaluateBindMounts requires absolute container paths', () => {
  const { blocked } = evaluateBindMounts([
    { host_path: '/opt/project-nomad/storage/x', container_path: 'relative' },
  ])
  assert.equal(blocked.length, 1)
})

check('evaluateBindMounts requires absolute host paths', () => {
  const { blocked } = evaluateBindMounts([
    { host_path: 'relative/path', container_path: '/data' },
  ])
  assert.equal(blocked.length, 1)
})

check('evaluateBindMounts hard-blocks a colon in the host path', () => {
  // Without this, Docker would re-split "/etc:foo" on the colon and mount /etc — bypassing the
  // system-directory block, which only matches the string as a whole path.
  const { blocked } = evaluateBindMounts([{ host_path: '/etc:foo', container_path: '/data' }])
  assert.equal(blocked.length, 1)
})

check('evaluateBindMounts hard-blocks a colon in the container path', () => {
  const { blocked } = evaluateBindMounts([
    { host_path: '/opt/project-nomad/storage/x', container_path: '/data:ro' },
  ])
  assert.equal(blocked.length, 1)
})

// ── Image references ──────────────────────────────────────────────────────────
check('evaluateImageReference warns on the latest tag', () => {
  const { blocked, warnings } = evaluateImageReference('nginx:latest')
  assert.equal(blocked.length, 0)
  assert.ok(warnings.some((w) => w.includes('moving tag')))
})

check('evaluateImageReference warns when no tag is given', () => {
  const { warnings } = evaluateImageReference('nginx')
  assert.ok(warnings.some((w) => w.includes('moving tag')))
})

check('evaluateImageReference is clean for a pinned image from a trusted registry', () => {
  const { blocked, warnings } = evaluateImageReference('ghcr.io/stirling-tools/s-pdf:0.30.1')
  assert.equal(blocked.length, 0)
  assert.equal(warnings.length, 0)
})

check('evaluateImageReference warns on an untrusted registry', () => {
  const { warnings } = evaluateImageReference('myregistry.example.com/app:1.0.0')
  assert.ok(warnings.some((w) => w.includes('trusted registries')))
})

check('evaluateImageReference blocks a malformed reference', () => {
  const { blocked } = evaluateImageReference('not a valid image!!')
  assert.equal(blocked.length, 1)
})

check('evaluateImageReference accepts a digest-pinned image without a moving-tag warning', () => {
  const { blocked, warnings } = evaluateImageReference('ghcr.io/org/app@sha256:' + 'a'.repeat(64))
  assert.equal(blocked.length, 0)
  assert.equal(warnings.length, 0)
})

// ── Combined evaluation + a clean end-to-end app (prompt's "a clean app passes") ─
check('evaluateCustomApp combines bind-mount and image findings', () => {
  const { blocked, warnings } = evaluateCustomApp({
    image: 'nginx:latest', // → 1 moving-tag warning
    volumes: [{ host_path: '/var/run/docker.sock', container_path: '/x' }], // → 1 block
  })
  assert.equal(blocked.length, 1)
  assert.equal(warnings.length, 1)
})

check('evaluateCustomApp passes a clean app (pinned trusted image, in-storage mount)', () => {
  const { blocked, warnings } = evaluateCustomApp({
    image: 'ghcr.io/stirling-tools/s-pdf:0.30.1',
    volumes: [{ host_path: '/opt/project-nomad/storage/spdf', container_path: '/data' }],
  })
  assert.equal(blocked.length, 0)
  assert.equal(warnings.length, 0)
})

check('evaluateCustomApp with no image and no volumes is clean', () => {
  const { blocked, warnings } = evaluateCustomApp({})
  assert.equal(blocked.length, 0)
  assert.equal(warnings.length, 0)
})

// ── Default resource caps (exported contract) ─────────────────────────────────
check('default resource caps are 1024 MB / 1 CPU', () => {
  assert.equal(DEFAULT_MEMORY_MB, 1024)
  assert.equal(DEFAULT_CPUS, 1)
})

console.log(`\n${passed} checks passed`)
