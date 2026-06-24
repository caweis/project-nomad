/**
 * Standalone test for the pure Vaultwarden HTTPS-migration decision.
 *
 * `vaultwardenNeedsTlsMigration` decides whether the boot-time reconcile in
 * DockerService.reconcileVaultwardenTls should recreate the container so
 * ROCKET_TLS takes effect. It is pure (no Docker), so it runs under
 * `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/vaultwarden_tls.standalone.ts
 */
import assert from 'node:assert/strict'
import { vaultwardenNeedsTlsMigration } from '../../app/services/vaultwarden_tls.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const TLS_ENV = 'ROCKET_TLS={certs="/data/certs/cert.pem",key="/data/certs/key.pem"}'

// ── needs migration ───────────────────────────────────────────────────────────
check('installed + HTTP container (no ROCKET_TLS) → migrate', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({
      installed: true,
      hasContainer: true,
      containerEnv: ['ROCKET_HEADER_SIZE=0', 'SIGNUPS_ALLOWED=false'],
    }),
    true
  )
})

check('installed + container with empty env → migrate', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({ installed: true, hasContainer: true, containerEnv: [] }),
    true
  )
})

// ── already migrated → no-op (idempotent) ─────────────────────────────────────
check('container already carries ROCKET_TLS → no migrate', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({ installed: true, hasContainer: true, containerEnv: [TLS_ENV] }),
    false
  )
})

check('ROCKET_TLS present among other env vars → no migrate', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({
      installed: true,
      hasContainer: true,
      containerEnv: ['SIGNUPS_ALLOWED=false', TLS_ENV, 'ROCKET_HEADER_SIZE=0'],
    }),
    false
  )
})

// ── nothing to migrate ────────────────────────────────────────────────────────
check('not installed → no migrate', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({ installed: false, hasContainer: true, containerEnv: [] }),
    false
  )
})

check('installed but no container yet → no migrate (a fresh install gets TLS)', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({ installed: true, hasContainer: false, containerEnv: [] }),
    false
  )
})

// A var that merely contains, but does not start with, ROCKET_TLS must not count
// as already-migrated.
check('a ROCKET_TLS substring that is not the env key → migrate', () => {
  assert.equal(
    vaultwardenNeedsTlsMigration({
      installed: true,
      hasContainer: true,
      containerEnv: ['NOTE=set ROCKET_TLS= later'],
    }),
    true
  )
})

console.log(`\n${passed} checks passed`)
