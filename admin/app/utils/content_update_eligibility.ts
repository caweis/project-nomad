/**
 * Per-resource eligibility for content (ZIM/map) auto-update. The job handles
 * the master-switch + time-window gating, and the caller computes cool-off with
 * the shared {@link isCooloffElapsed} helper and passes the result in (so this
 * stays a zero-import pure combinator, loadable by the strip-types harness and
 * not duplicating the cool-off math). This decides whether ONE installed
 * resource with a detected newer version may apply right now:
 *   1. not self-disabled by the failure backoff,
 *   2. below the failure threshold,
 *   3. its cool-off has elapsed,
 *   4. it fits under the remaining per-window byte cap (0 = unlimited).
 */

export interface ContentEligibilityInput {
  cooloffElapsed: boolean
  consecutiveFailures: number
  disabledReason: string | null
  /** Download size of the pending update; null when unknown (counts as 0 vs the cap). */
  sizeBytes: number | null
  bytesUsedThisWindow: number
  /** Per-window download budget in bytes; 0 = unlimited. */
  maxBytesPerWindow: number
  maxFailures: number
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string }

export function isContentUpdateEligible(input: ContentEligibilityInput): EligibilityResult {
  if (input.disabledReason) {
    return { eligible: false, reason: 'auto-update disabled for this resource' }
  }
  if (input.consecutiveFailures >= input.maxFailures) {
    return { eligible: false, reason: 'at the consecutive-failure threshold' }
  }
  if (!input.cooloffElapsed) {
    return { eligible: false, reason: 'cool-off has not elapsed' }
  }
  if (input.maxBytesPerWindow > 0) {
    const size = input.sizeBytes ?? 0
    if (input.bytesUsedThisWindow + size > input.maxBytesPerWindow) {
      return { eligible: false, reason: 'would exceed the per-window data cap' }
    }
  }
  return { eligible: true }
}
