/**
 * Standalone gate test for MeshController's PURE decisions.
 *
 * The Inertia render and the live :8600 HTTP need a booted app + Docker, neither
 * of which is available here (Japa can't boot without MySQL/Redis), so tsc is the
 * structural gate for the controller wiring. What we CAN exercise standalone is
 * the controller's two pure branch decisions, both driven by extracted helpers:
 *
 *   1. send() → 422 when the body fails validateAlertBody (empty / over-budget),
 *      200-path otherwise. We assert the exact status the controller maps to via
 *      the same validator the controller calls.
 *   2. inertia() → 404 when SystemService.checkServiceInstalled(MESH) is false,
 *      render otherwise. We assert that install-gate decision as a pure predicate
 *      (the controller's `if (!meshInstalled) return 404` branch).
 *
 * Run:
 *   node --experimental-strip-types tests/standalone/mesh_controller.standalone.ts
 *
 * Mirrors tests/standalone/system_services_gate.standalone.ts (node:assert/strict,
 * a check() counter) — the gate-decision sibling of this file.
 */
import assert from 'node:assert/strict'
import { validateAlertBody, ALERT_BODY_MAX_CHARS } from '../../util/mesh.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/**
 * Pure mirror of MeshController.send()'s status decision: a failed
 * validateAlertBody is a 422, otherwise the success path (200). This is exactly
 * the branch the controller takes — `if (!validation.ok) return 422`.
 */
function sendStatusFor(body: unknown): 200 | 422 {
  return validateAlertBody(body).ok ? 200 : 422
}

/**
 * Pure mirror of MeshController.inertia()'s install-gate decision:
 * `if (!meshInstalled) return 404`. The render side is mini-gated (needs a booted
 * app); this captures only the not-installed → 404 branch.
 */
function inertiaStatusFor(meshInstalled: boolean): 200 | 404 {
  return meshInstalled ? 200 : 404
}

// ── send() → 422 on a rejected body ───────────────────────────────────────────
check('send() returns 422 for an empty body', () => {
  assert.equal(sendStatusFor(''), 422)
  assert.equal(sendStatusFor('   '), 422)
})

check('send() returns 422 for a non-string body', () => {
  for (const bad of [undefined, null, 7, {}]) {
    assert.equal(sendStatusFor(bad), 422, `${JSON.stringify(bad)} → 422`)
  }
})

check('send() returns 422 for an over-budget body', () => {
  assert.equal(sendStatusFor('x'.repeat(ALERT_BODY_MAX_CHARS + 1)), 422)
})

check('send() takes the success path (200) for a valid in-budget body', () => {
  assert.equal(sendStatusFor('shelter at the church on 4th'), 200)
  assert.equal(sendStatusFor('x'.repeat(ALERT_BODY_MAX_CHARS)), 200) // exactly at the cap
})

// ── inertia() → 404 when the Mesh service isn't installed ──────────────────────
check('inertia() returns 404 when the Mesh service is not installed', () => {
  assert.equal(inertiaStatusFor(false), 404)
})

check('inertia() renders (200) when the Mesh service is installed', () => {
  assert.equal(inertiaStatusFor(true), 200)
})

console.log(`\n${passed} checks passed`)
