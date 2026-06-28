/**
 * Standalone test for the shared disk pre-flight (Phase 0).
 *
 *   node --experimental-strip-types tests/standalone/image_disk_preflight.standalone.ts
 *
 * Gates an auto-update apply on having room for the image (size * factor, or a
 * 5 GiB fallback when size is unknown). It must NEVER block on a transient
 * registry/disk lookup error — an off-grid box would otherwise auto-disable for
 * being offline. Services are injected as fakes; the `import type` deps erase
 * under strip-types.
 */
import assert from 'node:assert/strict'
import {
  checkImageDiskSpace,
  getFreeBytes,
  DISK_SAFETY_FACTOR,
  MIN_FREE_BYTES,
} from '../../app/utils/image_disk_preflight.ts'

let passed = 0
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    passed++
    console.log(`  ok - ${name}`)
  })
}

const GiB = 1024 * 1024 * 1024

// duck-typed fakes cast to the injected service types
const registry = (size: number | null) =>
  ({
    parseImageReference: (image: string) => ({
      registry: 'r',
      fullName: 'n',
      tag: image.split(':')[1] ?? 'latest',
    }),
    getImageDownloadSize: async () => size,
  }) as any

const system = (fsSize: Array<{ mount: string; available: number }> | null) =>
  ({ getSystemInfo: async () => (fsSize === null ? undefined : { fsSize }) }) as any

const throwingRegistry = () =>
  ({
    parseImageReference: () => {
      throw new Error('boom')
    },
    getImageDownloadSize: async () => null,
  }) as any

await check('constants are as expected', async () => {
  assert.equal(DISK_SAFETY_FACTOR, 2)
  assert.equal(MIN_FREE_BYTES, 5 * GiB)
})

await check('getFreeBytes prefers the root mount', async () => {
  const free = await getFreeBytes(
    system([
      { mount: '/data', available: 99 * GiB },
      { mount: '/', available: 10 * GiB },
    ])
  )
  assert.equal(free, 10 * GiB)
})

await check('getFreeBytes falls back to the max available when no root mount', async () => {
  const free = await getFreeBytes(
    system([
      { mount: '/a', available: 3 * GiB },
      { mount: '/b', available: 7 * GiB },
    ])
  )
  assert.equal(free, 7 * GiB)
})

await check('getFreeBytes returns null when no filesystem info', async () => {
  assert.equal(await getFreeBytes(system(null)), null)
  assert.equal(await getFreeBytes(system([])), null)
})

await check('no blocker when free space exceeds size * factor', async () => {
  const r = await checkImageDiskSpace({
    image: 'ollama/ollama:1.0',
    hostArch: 'arm64',
    containerRegistryService: registry(2 * GiB), // needs 4 GiB
    systemService: system([{ mount: '/', available: 10 * GiB }]),
  })
  assert.equal(r, null)
})

await check('failure blocker when free space is below size * factor', async () => {
  const r = await checkImageDiskSpace({
    image: 'ollama/ollama:1.0',
    hostArch: 'arm64',
    containerRegistryService: registry(3 * GiB), // needs 6 GiB
    systemService: system([{ mount: '/', available: 4 * GiB }]),
  })
  assert.equal(r?.severity, 'failure')
  assert.ok(r?.reason.includes('Insufficient disk space'))
})

await check('unknown image size falls back to the 5 GiB minimum (blocks below it)', async () => {
  const r = await checkImageDiskSpace({
    image: 'x/y:1.0',
    hostArch: 'arm64',
    containerRegistryService: registry(null),
    systemService: system([{ mount: '/', available: 4 * GiB }]),
  })
  assert.equal(r?.severity, 'failure')
})

await check('unknown image size with >= 5 GiB free does not block', async () => {
  const r = await checkImageDiskSpace({
    image: 'x/y:1.0',
    hostArch: 'arm64',
    containerRegistryService: registry(null),
    systemService: system([{ mount: '/', available: 6 * GiB }]),
  })
  assert.equal(r, null)
})

await check('never blocks when free space is undeterminable (warn fires)', async () => {
  let warned = ''
  const r = await checkImageDiskSpace({
    image: 'x/y:1.0',
    hostArch: 'arm64',
    containerRegistryService: registry(2 * GiB),
    systemService: system(null),
    warn: (m) => (warned = m),
  })
  assert.equal(r, null)
  assert.ok(warned.includes('free disk space'))
})

await check('never blocks on a transient lookup error', async () => {
  const r = await checkImageDiskSpace({
    image: 'x/y:1.0',
    hostArch: 'arm64',
    containerRegistryService: throwingRegistry(),
    systemService: system([{ mount: '/', available: 1 * GiB }]),
  })
  assert.equal(r, null)
})

console.log(`\n${passed} passed`)
