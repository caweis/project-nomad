/**
 * Whether a chat reply can be cancelled mid-generation without hurting the
 * backend that is producing it.
 *
 * Ollama builds before the fix never cancelled in-flight generation when the
 * client disconnected: the runner was left spinning at 300%+ CPU with no
 * request attached and did not recover without a restart (upstream #1321; the
 * fix landed somewhere between 0.24 and 0.33). This fork installs Ollama
 * through Homebrew and never pins it, so an install from June that has not been
 * upgraded is exactly that build. On it, letting an abandoned reply run to the
 * end costs one wasted answer, and cancelling it can cost the AI Assistant.
 *
 * 0.33.3 is the first build upstream verified the fix on, so it is the floor
 * here. An unknown version fails closed: not cancelling is the behaviour every
 * release before this one shipped with.
 *
 * Pure, so it runs under bare `node --experimental-strip-types`.
 */

export const MIN_CANCEL_SAFE_OLLAMA = '0.33.3'

/** Leading major.minor.patch of an Ollama version string, or null. */
export function parseOllamaVersion(version: string | null | undefined): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec((version ?? '').trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return true
}

/**
 * @param backend NOMAD_AI_BACKEND: 'omlx', 'ollama', or unset (which means ollama)
 * @param nativeVersion what native Ollama's /api/version reported, or null
 */
export function canCancelGeneration(
  backend: string | undefined,
  nativeVersion: string | null
): boolean {
  // On oMLX, chat is served by Apple MLX behind the proxy, not by an Ollama
  // runner, so the bug above is not in the path.
  if (backend === 'omlx') return true
  const parsed = parseOllamaVersion(nativeVersion)
  // A source build reports 0.0.0; unknown and unparseable both fail closed.
  if (!parsed || (parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0)) return false
  return atLeast(parsed, parseOllamaVersion(MIN_CANCEL_SAFE_OLLAMA)!)
}
