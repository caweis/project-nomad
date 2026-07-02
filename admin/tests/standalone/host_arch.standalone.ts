/**
 * Standalone test for the Docker→OCI architecture mapping.
 *
 *   node --experimental-strip-types tests/standalone/host_arch.standalone.ts
 *
 * The registry manifest lookup needs the OCI arch name ("amd64"/"arm64"), but
 * Docker's `info().Architecture` reports the uname form ("x86_64"/"aarch64").
 * A wrong mapping makes every update check request the wrong platform manifest.
 */
import assert from 'node:assert/strict'
import { mapDockerArch } from '../../app/utils/host_arch.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('x86_64 → amd64', () => assert.equal(mapDockerArch('x86_64'), 'amd64'))
check('aarch64 → arm64', () => assert.equal(mapDockerArch('aarch64'), 'arm64'))
check('armv7l → arm', () => assert.equal(mapDockerArch('armv7l'), 'arm'))
check('amd64 passes through', () => assert.equal(mapDockerArch('amd64'), 'amd64'))
check('arm64 passes through', () => assert.equal(mapDockerArch('arm64'), 'arm64'))
check('unknown arch falls through lowercased', () =>
  assert.equal(mapDockerArch('RISCV64'), 'riscv64'))
check('empty string stays empty', () => assert.equal(mapDockerArch(''), ''))

console.log(`\n${passed} passed`)
