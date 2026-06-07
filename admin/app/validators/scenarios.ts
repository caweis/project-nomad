import vine from '@vinejs/vine'
import { SCENARIOS } from '../../types/scenarios.js'

/**
 * Self-Reliance Suite — Scenario Plans request validators.
 *
 * The `scenario` field is constrained to the SCENARIOS constant in
 * types/scenarios.ts; the DB column is a plain varchar, so validation lives here
 * at the boundary (the stl_library.ts / inventory.ts convention).
 *
 * A step's cross-link is at most one of inventory_item_id / stl_file_id /
 * zim_ref. Vine validates the SHAPE of each field; the "at most one set" rule is
 * a pure, unit-shaped helper (atMostOneLink) the controller calls, mirroring
 * inventory.ts's resourceMappingValid — easier to test than a Vine refinement
 * and reusable across the store/update step paths.
 */

export const idParamValidator = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
  })
)

// ─── Plans ──────────────────────────────────────────────────────────────────

export const createPlanValidator = vine.compile(
  vine.object({
    scenario: vine.enum(SCENARIOS),
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
  })
)

export const updatePlanValidator = vine.compile(
  vine.object({
    scenario: vine.enum(SCENARIOS).optional(),
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
  })
)

// ─── Steps ────────────────────────────────────────────────────────────────────

export const createStepValidator = vine.compile(
  vine.object({
    text: vine.string().trim().minLength(1).maxLength(1000),
    position: vine.number().min(0).optional(),
    inventory_item_id: vine.number().positive().nullable().optional(),
    stl_file_id: vine.number().positive().nullable().optional(),
    zim_ref: vine.string().trim().maxLength(1024).nullable().optional(),
  })
)

export const updateStepValidator = vine.compile(
  vine.object({
    text: vine.string().trim().minLength(1).maxLength(1000).optional(),
    position: vine.number().min(0).optional(),
    checked: vine.boolean().optional(),
    inventory_item_id: vine.number().positive().nullable().optional(),
    stl_file_id: vine.number().positive().nullable().optional(),
    zim_ref: vine.string().trim().maxLength(1024).nullable().optional(),
  })
)

export const toggleStepValidator = vine.compile(
  vine.object({
    checked: vine.boolean(),
  })
)

/**
 * Cross-field rule (pure, so it's unit-shaped and testable): a step links to AT
 * MOST one target. More than one of inventory_item_id / stl_file_id / zim_ref
 * being set is rejected, so resolveStepLink's precedence is never relied on for
 * correctness (it's only defense in depth).
 *
 * `undefined` means "field not present in this (partial) payload" — permissive
 * for updates. Only explicitly-set, non-null values count toward the at-most-one
 * tally. A blank/whitespace zim_ref counts as unset.
 */
export function atMostOneLink(link: {
  inventory_item_id?: number | null
  stl_file_id?: number | null
  zim_ref?: string | null
}): { ok: true } | { ok: false; error: string } {
  let count = 0
  if (link.inventory_item_id !== null && link.inventory_item_id !== undefined) count++
  if (link.stl_file_id !== null && link.stl_file_id !== undefined) count++
  if (link.zim_ref !== null && link.zim_ref !== undefined && link.zim_ref.trim() !== '') count++

  if (count > 1) {
    return {
      ok: false,
      error: 'A step can link to at most one target (inventory item, STL file, or ZIM article).',
    }
  }
  return { ok: true }
}
