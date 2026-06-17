/**
 * Standalone test for the pure custom-app port logic (S3).
 *
 * The Docker-touching methods (`SystemService.getNextSuggestedCustomPort`,
 * `DockerService.checkPortConflicts`) defer their arithmetic to two pure helpers in
 * `app/services/custom_app_ports.ts`. There is no Docker daemon in this harness, so only the
 * pure logic is exercised here — the socket calls are mini-gated and deliberately not run.
 *
 * Run: node --experimental-strip-types tests/standalone/custom_app_port_logic.standalone.ts
 */
import assert from 'node:assert/strict'
import {
  CUSTOM_PORT_START,
  nextFreeCustomPort,
  findDuplicateHostPorts,
} from '../../app/services/custom_app_ports.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── nextFreeCustomPort: next free host port in the 8600+ band, stepping by 10 ──
check('custom port band starts at 8600', () => {
  assert.equal(CUSTOM_PORT_START, 8600)
})

check('nextFreeCustomPort returns 8600 when nothing is occupied', () => {
  assert.equal(nextFreeCustomPort(new Set()), 8600)
})

check('nextFreeCustomPort skips an occupied 8600 to 8610', () => {
  assert.equal(nextFreeCustomPort(new Set([8600])), 8610)
})

check('nextFreeCustomPort skips a contiguous run', () => {
  assert.equal(nextFreeCustomPort(new Set([8600, 8610, 8620])), 8630)
})

check('nextFreeCustomPort ignores out-of-step occupied ports', () => {
  // 8605 is not on the 10-step grid, so it never collides with a candidate.
  assert.equal(nextFreeCustomPort(new Set([8605])), 8600)
})

check('nextFreeCustomPort steps over a gap in the middle of the band', () => {
  // 8600 and 8610 taken, 8620 free.
  assert.equal(nextFreeCustomPort(new Set([8600, 8610])), 8620)
})

// ── findDuplicateHostPorts: dupes within a single request ──────────────────────
check('findDuplicateHostPorts returns [] when all host ports are unique', () => {
  assert.deepEqual(findDuplicateHostPorts([8600, 8610, 8620]), [])
})

check('findDuplicateHostPorts flags a single duplicated host port once', () => {
  assert.deepEqual(findDuplicateHostPorts([8600, 8600, 8610]), [8600])
})

check('findDuplicateHostPorts dedupes the duplicate list itself (triple → once)', () => {
  assert.deepEqual(findDuplicateHostPorts([8600, 8600, 8600]), [8600])
})

check('findDuplicateHostPorts reports multiple distinct duplicates', () => {
  assert.deepEqual(findDuplicateHostPorts([8600, 8600, 8610, 8610]), [8600, 8610])
})

check('findDuplicateHostPorts on an empty request is []', () => {
  assert.deepEqual(findDuplicateHostPorts([]), [])
})

console.log(`\n${passed} checks passed`)
