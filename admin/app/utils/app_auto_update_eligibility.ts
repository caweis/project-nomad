/**
 * Per-app eligibility for installed-container (sibling) auto-update. A pure,
 * zero-import combinator (so the strip-types harness can load it): the caller
 * supplies the master switch, per-app opt-in, window result, whether a same-major
 * newer version is available, cool-off, and backoff state. Two-layer consent is
 * mandatory — BOTH the global master switch AND the per-app toggle must be on —
 * and a major-version change is never auto-applied (it can carry breaking config).
 */

export interface AppEligibilityInput {
  masterEnabled: boolean
  perAppEnabled: boolean
  withinWindow: boolean
  /** A newer version is available for this app (differs from the installed tag). */
  hasUpdate: boolean
  /** The available update is the same major version as installed (not a major bump). */
  sameMajor: boolean
  cooloffElapsed: boolean
  consecutiveFailures: number
  disabledReason: string | null
  maxFailures: number
}

export type AppEligibilityResult = { eligible: true } | { eligible: false; reason: string }

export function isAppAutoUpdateEligible(input: AppEligibilityInput): AppEligibilityResult {
  if (!input.masterEnabled) return { eligible: false, reason: 'global auto-update is off' }
  if (!input.perAppEnabled) return { eligible: false, reason: 'auto-update is off for this app' }
  if (!input.withinWindow) return { eligible: false, reason: 'outside the update window' }
  if (!input.hasUpdate) return { eligible: false, reason: 'no newer version available' }
  if (!input.sameMajor) {
    return { eligible: false, reason: 'a major-version change must be applied manually' }
  }
  if (input.disabledReason) return { eligible: false, reason: 'auto-update disabled for this app' }
  if (input.consecutiveFailures >= input.maxFailures) {
    return { eligible: false, reason: 'at the consecutive-failure threshold' }
  }
  if (!input.cooloffElapsed) return { eligible: false, reason: 'cool-off has not elapsed' }
  return { eligible: true }
}
