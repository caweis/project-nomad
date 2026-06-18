/**
 * Standalone gate test for the Mesh Bridge pure helpers (util/mesh.ts).
 *
 * Japa cannot boot locally without MySQL/Redis, and the live HTTP against the
 * mesh container (nomad_mesh:8600) needs Docker — neither is available here. So
 * this file exercises the PURE pieces MeshService is built on — validateAlertBody
 * and parseMeshStatus (plus parseMeshMessages) — directly under
 * `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/mesh_service.standalone.ts
 *
 * Mirrors the shape of tests/standalone/readiness_pets.standalone.ts
 * (node:assert/strict, a check() counter).
 */
import assert from 'node:assert/strict'
import {
  validateAlertBody,
  parseMeshStatus,
  parseMeshMessages,
  ALERT_BODY_MAX_CHARS,
} from '../../util/mesh.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── validateAlertBody ─────────────────────────────────────────────────────────
check('validateAlertBody rejects an empty body', () => {
  const result = validateAlertBody('')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'empty')
})

check('validateAlertBody rejects a whitespace-only body', () => {
  const result = validateAlertBody('   \n\t ')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'empty')
})

check('validateAlertBody rejects a non-string body', () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    const result = validateAlertBody(bad)
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should be rejected`)
    if (!result.ok) assert.equal(result.reason, 'empty')
  }
})

check('validateAlertBody rejects an over-budget body', () => {
  const result = validateAlertBody('x'.repeat(ALERT_BODY_MAX_CHARS + 1))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'too_long')
    // The message names the actual length and the budget.
    assert.ok(result.message.includes(String(ALERT_BODY_MAX_CHARS)))
  }
})

check('validateAlertBody accepts a body exactly at the budget', () => {
  const result = validateAlertBody('x'.repeat(ALERT_BODY_MAX_CHARS))
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.body.length, ALERT_BODY_MAX_CHARS)
})

check('validateAlertBody accepts a normal alert and trims it', () => {
  const result = validateAlertBody('  evac route 7 blocked, use ridge trail  ')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.body, 'evac route 7 blocked, use ridge trail')
})

check('validateAlertBody measures the budget against the TRIMMED body', () => {
  // Body is at the cap once surrounding whitespace is stripped — must pass.
  const padded = '   ' + 'y'.repeat(ALERT_BODY_MAX_CHARS) + '   '
  const result = validateAlertBody(padded)
  assert.equal(result.ok, true)
})

// ── parseMeshStatus ───────────────────────────────────────────────────────────
check('parseMeshStatus maps a well-formed payload', () => {
  const status = parseMeshStatus({
    adapter: 'meshtastic',
    model: 'Heltec V3',
    connected: true,
    node_id: '!a1b2c3d4',
  })
  assert.equal(status.adapter, 'meshtastic')
  assert.equal(status.model, 'Heltec V3')
  assert.equal(status.connected, true)
  assert.equal(status.nodeId, '!a1b2c3d4')
})

check('parseMeshStatus accepts the camelCase nodeId variant', () => {
  const status = parseMeshStatus({ adapter: 'meshcore', connected: false, nodeId: 'node-7' })
  assert.equal(status.adapter, 'meshcore')
  assert.equal(status.nodeId, 'node-7')
})

check('parseMeshStatus is defensive on a malformed payload', () => {
  for (const bad of [null, undefined, 42, 'nope', []]) {
    const status = parseMeshStatus(bad)
    assert.equal(status.adapter, 'unknown')
    assert.equal(status.model, null)
    assert.equal(status.connected, false)
    assert.equal(status.nodeId, null)
  }
})

check('parseMeshStatus coerces wrong-typed fields to safe defaults', () => {
  const status = parseMeshStatus({ adapter: 123, model: '', connected: 'yes', node_id: '   ' })
  assert.equal(status.adapter, 'unknown') // non-string → default
  assert.equal(status.model, null) // empty string → null
  assert.equal(status.connected, false) // only boolean true counts as connected
  assert.equal(status.nodeId, null) // whitespace-only → null
})

// ── parseMeshMessages ─────────────────────────────────────────────────────────
check('parseMeshMessages maps a bare array and a {messages:[]} envelope', () => {
  const sample = [
    { id: '1', direction: 'in', peer: '!aaa', body: 'hello', timestamp: 1_700_000_000_000 },
    { direction: 'out', body: 'ack' },
  ]
  const fromArray = parseMeshMessages(sample)
  const fromEnvelope = parseMeshMessages({ messages: sample })
  assert.equal(fromArray.length, 2)
  assert.deepEqual(fromArray, fromEnvelope)
  assert.equal(fromArray[0].direction, 'in')
  assert.equal(fromArray[1].direction, 'out')
})

check('parseMeshMessages defaults an unknown direction to in and a missing body to empty', () => {
  const [msg] = parseMeshMessages([{ direction: 'sideways' }])
  assert.equal(msg.direction, 'in')
  assert.equal(msg.body, '')
})

check('parseMeshMessages drops non-object entries and is empty on garbage', () => {
  assert.deepEqual(parseMeshMessages('nope'), [])
  assert.deepEqual(parseMeshMessages(null), [])
  assert.equal(parseMeshMessages([null, 5, 'x', { direction: 'in', body: 'ok' }]).length, 1)
})

console.log(`\n${passed} checks passed`)
