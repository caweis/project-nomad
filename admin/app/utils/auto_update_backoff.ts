/**
 * Shared failure-backoff decision for opt-in auto-update (core, apps, content).
 *
 * After {@link MAX_CONSECUTIVE_FAILURES} genuine failures a tier/resource
 * self-disables so a perpetually-broken update doesn't retry forever. Offline or
 * busy conditions are SKIPs, not failures, and never advance the counter — an
 * off-grid appliance is offline most of the time and must not auto-disable for
 * it. A success clears the counter and any prior disable.
 *
 * This is the pure decision; persisting `failures`/`disabledReason` to the
 * model or KV store is the caller's job (model-free so it is standalone-testable
 * without a DB). The model-touching wrappers live with each tier's service.
 */

/** Genuine consecutive auto-update failures before a tier/resource self-disables. */
export const MAX_CONSECUTIVE_FAILURES = 3

export type BackoffOutcome = 'success' | 'failure' | 'skip'

export interface BackoffInput {
  outcome: BackoffOutcome
  currentFailures: number
  currentDisabledReason?: string | null
  /** Required for a 'failure' outcome — embedded in the disable message at the threshold. */
  reason?: string
}

export interface BackoffDecision {
  failures: number
  disabledReason: string | null
  /** Whether the persisted state needs to change (lets callers skip a redundant save). */
  changed: boolean
}

export function decideBackoff(input: BackoffInput): BackoffDecision {
  const { outcome, currentFailures } = input
  const currentDisabledReason = input.currentDisabledReason ?? null

  if (outcome === 'skip') {
    return { failures: currentFailures, disabledReason: currentDisabledReason, changed: false }
  }

  if (outcome === 'success') {
    const changed = currentFailures !== 0 || currentDisabledReason !== null
    return { failures: 0, disabledReason: null, changed }
  }

  // failure
  const failures = currentFailures + 1
  const disabledReason =
    failures >= MAX_CONSECUTIVE_FAILURES
      ? `Auto-update disabled after ${failures} consecutive failures. Last error: ${input.reason ?? 'unknown error'}`
      : null
  return { failures, disabledReason, changed: true }
}
