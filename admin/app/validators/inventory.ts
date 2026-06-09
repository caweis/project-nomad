import vine from '@vinejs/vine'
import {
  INVENTORY_CATEGORIES,
  INVENTORY_CONDITIONS,
  INVENTORY_KINDS,
  RESOURCE_TYPES,
} from '../../types/inventory.js'

/**
 * Self-Reliance Suite — Inventory request validators.
 *
 * Enum-valued fields (category, condition, resource_type) are constrained to
 * the constants in types/inventory.ts. The DB columns are plain varchars, so
 * validation lives here at the boundary — the stl_library.ts convention.
 *
 * Clearable fields use `.nullable().optional()` so the same payload shape can
 * either set or clear them. The create validator requires the always-present
 * fields (name, category, quantity, unit); the update validator makes
 * everything optional so one endpoint serves both "first fill" and "tweak."
 */

export const idParamValidator = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
  })
)

export const createInventoryItemValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    category: vine.enum(INVENTORY_CATEGORIES),
    // kind defaults to 'consumable' at the service when omitted.
    kind: vine.enum(INVENTORY_KINDS).optional(),
    quantity: vine.number().min(0),
    // Unit is OPTIONAL: consumables have one (gal/cans), but gear (a water
    // filter, a stove) has no consumable unit. The column is NOT NULL with a
    // ''-default, so an omitted/empty unit stores '' — no migration needed.
    unit: vine.string().trim().maxLength(32).optional(),
    location: vine.string().trim().maxLength(255).nullable().optional(),
    notes: vine.string().trim().maxLength(5000).nullable().optional(),
    expiry_date: vine.date().nullable().optional(),
    restock_threshold: vine.number().min(0).nullable().optional(),
    never_expires: vine.boolean().optional(),
    condition: vine.enum(INVENTORY_CONDITIONS).nullable().optional(),
    resource_type: vine.enum(RESOURCE_TYPES).nullable().optional(),
    resource_contribution: vine.number().min(0).nullable().optional(),
  })
)

export const updateInventoryItemValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    category: vine.enum(INVENTORY_CATEGORIES).optional(),
    kind: vine.enum(INVENTORY_KINDS).optional(),
    quantity: vine.number().min(0).optional(),
    unit: vine.string().trim().maxLength(32).optional(),
    location: vine.string().trim().maxLength(255).nullable().optional(),
    notes: vine.string().trim().maxLength(5000).nullable().optional(),
    expiry_date: vine.date().nullable().optional(),
    restock_threshold: vine.number().min(0).nullable().optional(),
    never_expires: vine.boolean().optional(),
    condition: vine.enum(INVENTORY_CONDITIONS).nullable().optional(),
    resource_type: vine.enum(RESOURCE_TYPES).nullable().optional(),
    resource_contribution: vine.number().min(0).nullable().optional(),
  })
)

export const listInventoryItemsValidator = vine.compile(
  vine.object({
    category: vine.enum(INVENTORY_CATEGORIES).optional(),
    kind: vine.enum(INVENTORY_KINDS).optional(),
    condition: vine.enum(INVENTORY_CONDITIONS).optional(),
    location: vine.string().trim().minLength(1).maxLength(255).optional(),
    search: vine.string().trim().minLength(1).maxLength(200).optional(),
    expiring_within_days: vine.number().min(0).max(3650).optional(),
    low_stock: vine.boolean().optional(),
    page: vine.number().min(1).optional(),
    per_page: vine.number().min(1).max(200).optional(),
  })
)

/**
 * Cross-field rule (pure, so it's unit-testable): if an item is mapped to a
 * resource, its contribution must be a positive amount, otherwise the row would
 * pollute the calculator with a zero/negative contribution. Conversely an
 * unmapped item (resource_type null/undefined) must not carry a contribution.
 *
 * Vine's `requiredWhen` can't express "> 0 when set" as cleanly as a tested
 * pure function, and the controller already mirrors the recompute pattern of
 * StlFile.isMetadataComplete — so the gate lives here and the controller calls
 * it (suite design spec §9 Q4: prefer the pure helper for testability).
 *
 * `undefined` is treated as "field not present in this (partial) payload" and
 * is permissive for updates — only an explicit non-null resource_type triggers
 * the contribution requirement.
 */
export function resourceMappingValid(
  resourceType: string | null | undefined,
  resourceContribution: number | null | undefined
): { ok: true } | { ok: false; error: string } {
  const mapped = resourceType !== null && resourceType !== undefined

  if (mapped) {
    if (resourceContribution === null || resourceContribution === undefined) {
      return {
        ok: false,
        error: 'resource_contribution is required when resource_type is set.',
      }
    }
    if (resourceContribution <= 0) {
      return {
        ok: false,
        error: 'resource_contribution must be greater than 0 when resource_type is set.',
      }
    }
    return { ok: true }
  }

  // Unmapped: an explicit resource_type=null with a contribution is contradictory.
  if (resourceType === null && (resourceContribution ?? 0) > 0) {
    return {
      ok: false,
      error: 'resource_contribution must be empty when the item has no resource_type.',
    }
  }

  return { ok: true }
}
