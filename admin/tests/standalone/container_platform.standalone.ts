/**
 * Standalone checks for naming a container platform in an app's config
 * (upstream #1292: its translation image is amd64 only).
 *
 *   node --experimental-strip-types tests/standalone/container_platform.standalone.ts
 *
 * What matters is that nothing else changes. Every other app has no `platform`
 * and must keep getting Docker's own choice; and a value that is not a platform
 * must never reach Docker, where it would fail an install with a parse error.
 */
import assert from 'node:assert/strict'
import { platformFromContainerConfig } from '../../app/utils/container_platform.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

check('an app that names a platform gets that platform', () => {
  assert.equal(
    platformFromContainerConfig({ platform: 'linux/amd64', Env: ['A=1'] }),
    'linux/amd64'
  )
  assert.equal(platformFromContainerConfig({ platform: 'linux/arm64' }), 'linux/arm64')
  assert.equal(platformFromContainerConfig({ platform: 'linux/arm64/v8' }), 'linux/arm64/v8')
})

check('an app that names none leaves the choice to Docker', () => {
  assert.equal(platformFromContainerConfig({ HostConfig: {}, Env: [] }), undefined)
  assert.equal(platformFromContainerConfig({}), undefined)
})

check('a missing or unreadable config is no platform, not an error', () => {
  for (const config of [null, undefined, '', 'linux/amd64', 42, true, []]) {
    assert.equal(platformFromContainerConfig(config), undefined, JSON.stringify(config))
  }
})

check('anything that is not a platform never reaches Docker', () => {
  for (const platform of [
    '',
    'amd64',
    'linux',
    'linux/',
    'linux/amd64; rm -rf /',
    'linux/amd64 ',
    ' linux/amd64',
    'windows/amd64',
    'linux/riscv64',
    'LINUX/AMD64',
    42,
    null,
    ['linux/amd64'],
    { os: 'linux' },
  ]) {
    assert.equal(platformFromContainerConfig({ platform }), undefined, JSON.stringify(platform))
  }
})

console.log(`\n${passed} checks passed`)
