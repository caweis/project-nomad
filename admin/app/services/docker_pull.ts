/**
 * Pure wrapper around dockerode's `modem.followProgress(stream, onFinished)`
 * that turns the callback-with-error contract into a Promise which *rejects* on
 * a pull failure instead of silently resolving. Extracted from DockerService so
 * the reject-on-error behavior can be unit-tested under
 * `node --experimental-strip-types` with a stub modem — no real Docker socket.
 *
 * Ported from upstream commit fe78df5 (fix(docker): reject failed image pulls
 * instead of treating them as success, #790). The bug was that every call site
 * passed the Promise's `resolve` directly as dockerode's
 * `onFinished(err, output)` callback, so the error argument was ignored and a
 * failed pull resolved as if it had succeeded.
 */

/** Minimal shape of dockerode's modem we depend on (keeps this import-free). */
export interface FollowProgressModem {
  followProgress(
    stream: unknown,
    onFinished: (error: Error | null, output?: unknown) => void
  ): void
}

/**
 * Await a Docker pull stream, resolving only when the pull genuinely completes
 * and rejecting with the real error when `followProgress` reports one.
 */
export function followPullProgress(modem: FollowProgressModem, stream: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    modem.followProgress(stream, (error: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * Normalize an image reference for `docker.pull`. dockerode's pull runs
 * `parseRepositoryTag`, which splits on the FIRST '@' and leaves any `:tag`
 * glued to the repository — so a digest-pinned ref like `repo:1.36.0@sha256:...`
 * pulls as `fromImage=repo:1.36.0&tag=sha256:...`, a malformed (both tagged AND
 * digested) reference the engine rejects. When a digest is present, pull by
 * digest only: strip the human `:tag` so the ref is `repo@sha256:...`. Tag-only
 * refs (no digest) and a registry `host:port` prefix are left untouched.
 */
export function pullableImageRef(image: string): string {
  const at = image.indexOf('@')
  if (at === -1) return image // tag-only or bare ref — pulls fine as-is
  const name = image.slice(0, at)
  const digest = image.slice(at) // includes the leading '@'
  // A `:tag` is a colon AFTER the last '/'. A registry `host:port` colon comes
  // BEFORE the last '/' and must be kept.
  const lastColon = name.lastIndexOf(':')
  const lastSlash = name.lastIndexOf('/')
  const repo = lastColon > lastSlash ? name.slice(0, lastColon) : name
  return repo + digest
}
