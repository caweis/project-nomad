/**
 * Standalone validator test for the custom-app VineJS schema (S4).
 *
 * VineJS compiles + validates under `node --experimental-strip-types` without the Adonis
 * runtime, so these drive the *real* compiled schemas (not an extracted copy) — the load-bearing
 * regexes and bounds are exactly what the controller enforces at the trust boundary:
 *   - host port floor of 1024 (no privileged ports)
 *   - the /^[^:]+$/ colon block on volume paths (pairs with the guard against mount smuggling)
 *   - the KEY=value env-var shape
 *
 * Run: node --experimental-strip-types tests/standalone/custom_app_validator.standalone.ts
 */
import assert from 'node:assert/strict'
import {
  customAppValidator,
  updateCustomAppValidator,
  normalizeCustomUrl,
} from '../../app/validators/system.ts'

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** Assert that validating `input` rejects (throws a VineJS validation error). */
async function expectReject(validator: { validate: (i: any) => Promise<any> }, input: any) {
  await assert.rejects(() => validator.validate(input))
}

const base = {
  friendly_name: 'My App',
  image: 'ghcr.io/org/app:1.0.0',
}

// ── A clean payload passes (sanity anchor) ─────────────────────────────────────
await check('customAppValidator accepts a clean payload', async () => {
  const out = await customAppValidator.validate({
    ...base,
    ports: [{ container: 80, host: 8600 }],
    volumes: [{ host_path: '/opt/project-nomad/storage/app', container_path: '/data' }],
    env: ['FOO=bar', 'EMPTY='],
    category: 'utility',
    memory_mb: 512,
    cpus: 1.5,
  })
  assert.equal(out.friendly_name, 'My App')
})

// ── Host port floor: privileged ports (<1024) are rejected ─────────────────────
await check('customAppValidator rejects a host port below 1024', async () => {
  await expectReject(customAppValidator, { ...base, ports: [{ container: 80, host: 80 }] })
})

await check('customAppValidator rejects a host port of 1023 (boundary)', async () => {
  await expectReject(customAppValidator, { ...base, ports: [{ container: 80, host: 1023 }] })
})

await check('customAppValidator accepts a host port of exactly 1024', async () => {
  const out = await customAppValidator.validate({ ...base, ports: [{ container: 80, host: 1024 }] })
  assert.equal(out.ports?.[0].host, 1024)
})

// ── Volume colon block: the parse-differential guard ───────────────────────────
await check('customAppValidator rejects a colon in the volume host_path', async () => {
  await expectReject(customAppValidator, {
    ...base,
    volumes: [{ host_path: '/etc:foo', container_path: '/data' }],
  })
})

await check('customAppValidator rejects a colon in the volume container_path', async () => {
  await expectReject(customAppValidator, {
    ...base,
    volumes: [{ host_path: '/opt/project-nomad/storage/x', container_path: '/data:ro' }],
  })
})

// ── Env var shape: must be KEY=value ───────────────────────────────────────────
await check('customAppValidator rejects a malformed env var (no equals)', async () => {
  await expectReject(customAppValidator, { ...base, env: ['NOT_AN_ASSIGNMENT'] })
})

await check('customAppValidator rejects an env var whose key starts with a digit', async () => {
  await expectReject(customAppValidator, { ...base, env: ['1FOO=bar'] })
})

await check('customAppValidator accepts an env var with an empty value', async () => {
  const out = await customAppValidator.validate({ ...base, env: ['EMPTY='] })
  assert.deepEqual(out.env, ['EMPTY='])
})

// ── cpus bounds (0.1 – 64) ─────────────────────────────────────────────────────
await check('customAppValidator rejects cpus below 0.1', async () => {
  await expectReject(customAppValidator, { ...base, cpus: 0.05 })
})

await check('customAppValidator rejects cpus above 64', async () => {
  await expectReject(customAppValidator, { ...base, cpus: 128 })
})

await check('customAppValidator rejects memory_mb below 64', async () => {
  await expectReject(customAppValidator, { ...base, memory_mb: 32 })
})

await check('customAppValidator rejects an out-of-enum category', async () => {
  await expectReject(customAppValidator, { ...base, category: 'malware' })
})

// ── updateCustomAppValidator carries the same guards + requires service_name ────
await check('updateCustomAppValidator requires service_name', async () => {
  await expectReject(updateCustomAppValidator, { ...base, ports: [{ container: 80, host: 8600 }] })
})

await check('updateCustomAppValidator rejects a privileged host port too', async () => {
  await expectReject(updateCustomAppValidator, {
    service_name: 'nomad_custom_x',
    ...base,
    ports: [{ container: 80, host: 22 }],
  })
})

// ── normalizeCustomUrl blocks non-http(s) schemes (javascript:/data:) ──────────
await check('normalizeCustomUrl blocks a javascript: URL', () => {
  assert.equal(normalizeCustomUrl('javascript:alert(1)'), null)
  return Promise.resolve()
})

await check('normalizeCustomUrl returns null for empty (clears the override)', () => {
  assert.equal(normalizeCustomUrl(''), null)
  assert.equal(normalizeCustomUrl(null), null)
  return Promise.resolve()
})

await check('normalizeCustomUrl prepends http:// to a bare host', () => {
  assert.equal(normalizeCustomUrl('jellyfin.myhomelab.net'), 'http://jellyfin.myhomelab.net/')
  return Promise.resolve()
})

await check('normalizeCustomUrl preserves an explicit https:// URL', () => {
  assert.equal(normalizeCustomUrl('https://jellyfin.myhomelab.net'), 'https://jellyfin.myhomelab.net/')
  return Promise.resolve()
})

console.log(`\n${passed} checks passed`)
