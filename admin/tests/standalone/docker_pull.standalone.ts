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
import { followPullProgress, type FollowProgressModem } from '../../app/services/docker_pull.ts'

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

  console.log(`\n${passed} checks passed`)
})()
