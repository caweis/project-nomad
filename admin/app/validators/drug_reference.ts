import vine from '@vinejs/vine'
import { PRODUCT_TYPES } from '../../types/drug_reference.js'

/**
 * Drug Reference v1 — request validators.
 *
 * Mirrors the stl_library validators: vine, minimal, typed at the edge.
 */

const PRODUCT_TYPE_VALUES = Object.values(PRODUCT_TYPES) as [string, ...string[]]

/** GET /api/drug-reference/search */
export const searchDrugValidator = vine.compile(
  vine.object({
    q: vine.string().trim().minLength(1).maxLength(200),
    product_type: vine.enum(PRODUCT_TYPE_VALUES).optional(),
    limit: vine.number().min(1).max(200).optional(),
    offset: vine.number().min(0).optional(),
    scope: vine.enum(['name', 'indication'] as const).optional(),
  })
)

/** POST /api/drug-reference/download — no body required; just trigger. */
export const downloadDrugValidator = vine.compile(
  vine.object({})
)
