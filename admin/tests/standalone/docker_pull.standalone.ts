/**
 * Standalone test for the pull-reject behavior (#790).
 *
 * `DockerService.pullImage` defers its followProgress handling to the pure
 * `followPullProgress` in `app/services/docker_pull.ts`, which rejects when
 * dockerode reports a pull error instead of silently resolving (the original
 * bug). Exercised here with a stub modem under `node --experimental-strip-types`
 * — no real Docker socket. Run:
 *   node --experimental-strip-types tests/standalone/docker_pull.standalone.ts
 *
 * Ported from upstream commit fe78df5's pullImage helper.
 */
import assert from 'node:assert/strict'
import {
  followPullProgress,
  pullableImageRef,
  type FollowProgressModem,
} from '../../app/services/docker_pull.ts'

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

// A stub modem whose followProgress invokes the onFinished callback exactly as
// dockerode would: (error, output). We drive both the failure and success arms.
function stubModem(error: Error | null): FollowProgressModem {
  return {
    followProgress(_stream, onFinished) {
      // Async to mirror dockerode (the callback fires after stream drain).
      setImmediate(() => onFinished(error))
    },
  }
}

await (async () => {
  // ── rejects on a followProgress error (the bug this fixes) ──────────────────
  await check('rejects with the real error when followProgress reports one', async () => {
    const boom = new Error('manifest unknown: manifest tagged latest not found')
    const modem = stubModem(boom)
    await assert.rejects(() => followPullProgress(modem, {}), /manifest unknown/)
  })

  await check('propagates the exact Error instance, not a wrapper', async () => {
    const boom = new Error('disk full mid-pull')
    let caught: unknown
    try {
      await followPullProgress(stubModem(boom), {})
    } catch (e) {
      caught = e
    }
    assert.equal(caught, boom)
  })

  // ── resolves on success (null error) ────────────────────────────────────────
  await check('resolves when followProgress finishes with a null error', async () => {
    await followPullProgress(stubModem(null), {})
    // No throw == pass.
  })

  await check('resolves to undefined (void) on success', async () => {
    const result = await followPullProgress(stubModem(null), {})
    assert.equal(result, undefined)
  })

  // ── pullableImageRef: digest-pin normalization (the Wave-2 pull-format fix) ───
  // dockerode's pull splits on the first '@' and leaves the tag glued to the
  // repository, breaking a `repo:tag@sha256:...` ref. The helper strips the tag
  // when a digest is present so the pull is by digest only.
  const refCases: Array<[string, string]> = [
    ['vaultwarden/server:1.36.0@sha256:abc', 'vaultwarden/server@sha256:abc'],
    ['stirlingtools/stirling-pdf:2.12.0@sha256:abc', 'stirlingtools/stirling-pdf@sha256:abc'],
    ['ghcr.io/corentinth/it-tools:2024.10.22-7ca5933@sha256:abc', 'ghcr.io/corentinth/it-tools@sha256:abc'],
    ['excalidraw/excalidraw:latest@sha256:abc', 'excalidraw/excalidraw@sha256:abc'],
    ['lscr.io/linuxserver/calibre-web:0.6.26-ls387@sha256:abc', 'lscr.io/linuxserver/calibre-web@sha256:abc'],
    ['vaultwarden/server@sha256:abc', 'vaultwarden/server@sha256:abc'], // already digest-only
    ['qdrant/qdrant:v1.16', 'qdrant/qdrant:v1.16'], // tag-only, no digest
    ['ghcr.io/meshtastic/web:v2.7.1', 'ghcr.io/meshtastic/web:v2.7.1'], // registry + tag, no digest
    ['redis', 'redis'], // bare name
    ['registry.local:5000/app@sha256:abc', 'registry.local:5000/app@sha256:abc'], // host:port kept (no tag)
    ['registry.local:5000/app:1.2.3@sha256:abc', 'registry.local:5000/app@sha256:abc'], // strip tag, keep port
  ]
  for (const [input, expected] of refCases) {
    await check(`pullableImageRef ${input} -> ${expected}`, async () => {
      assert.equal(pullableImageRef(input), expected)
    })
  }

  console.log(`\n${passed} checks passed`)
})()
