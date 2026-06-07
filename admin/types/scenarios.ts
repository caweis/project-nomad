/**
 * Self-Reliance Suite — Scenario Plans shared enums and TypeScript types.
 *
 * Phase 3 of the Self-Reliance Suite (see
 * docs/superpowers/specs/2026-06-06-self-reliance-suite-design.md §6). Editable,
 * checkable per-scenario plans whose steps can cross-link to an inventory item,
 * an STL file, or a ZIM article.
 *
 * The `scenario` enum is the single source of truth: the DB column is a plain
 * varchar (validated at the Vine layer, not in MySQL) so the set can grow
 * without an ALTER TABLE — the stl_library.ts / inventory.ts pattern.
 */

import type { StepLinkKind } from '../util/scenario_links.js'

export const SCENARIOS = [
  'blackout',
  'evacuation',
  'medical',
  'water-contamination',
  'other',
] as const

export type Scenario = (typeof SCENARIOS)[number]

/** Human-friendly scenario labels for badges, filters, and group headers. */
export const SCENARIO_LABELS: Record<Scenario, string> = {
  blackout: 'Blackout',
  evacuation: 'Evacuation',
  medical: 'Medical',
  'water-contamination': 'Water contamination',
  other: 'Other',
}

/**
 * The single optional cross-link a step carries, as the wire DTO sees it. At
 * most one of the three id/ref fields is non-null (validator-enforced); the
 * pure helper resolveStepLink turns these into a { kind, href } the UI renders.
 */
export interface StepLinkFields {
  inventory_item_id: number | null
  stl_file_id: number | null
  zim_ref: string | null
}

/**
 * One step of a plan, as returned to the detail page. Carries the link fields
 * plus the resolved cross-link target's display name (when the controller
 * preloaded it) so the UI can label the link without a second fetch. A null
 * `linked_name` means either no link or a removed target (SET NULL degraded it).
 */
export interface ScenarioPlanStepDto extends StepLinkFields {
  id: number
  plan_id: number
  position: number
  text: string
  checked: boolean
  /** Resolved display label for the linked inventory item / STL file, if any. */
  linked_name: string | null
}

/**
 * A plan in the list view — header fields plus the done/total step tally so the
 * card can show "3 / 7 steps done" without shipping every step.
 */
export interface ScenarioPlanSlim {
  id: number
  scenario: Scenario
  title: string
  description: string | null
  total_steps: number
  checked_steps: number
}

/** A full plan with its ordered steps, for the detail page. */
export interface ScenarioPlanDetail {
  id: number
  scenario: Scenario
  title: string
  description: string | null
  steps: ScenarioPlanStepDto[]
}

/** Re-export the helper's kind union so pages can import everything from one place. */
export type { StepLinkKind }
