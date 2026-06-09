import type { ResourceType } from '../types/inventory.js'

/**
 * Whether an inventory item contributes a positive amount to readiness.
 *
 * Single source of truth — importable from both the backend (app/models,
 * app/services) and the inertia client (inertia/components). The model's
 * static `contributesToReadiness` delegates here; the card imports directly.
 *
 * Pure function; no I/O, no side effects — unit-testable without DB.
 */
export function contributesToReadiness(row: {
  resource_type: ResourceType | null
  resource_contribution: number | null
}): boolean {
  return (
    row.resource_type !== null &&
    row.resource_contribution !== null &&
    row.resource_contribution > 0
  )
}
