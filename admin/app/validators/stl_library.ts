import vine from '@vinejs/vine'
import {
  STL_CATEGORIES,
  STL_DIFFICULTIES,
  STL_MATERIALS,
} from '../../types/stl_library.js'

/**
 * Workshop / Offline STL Library — request validators.
 *
 * Categories, materials, and difficulties are constrained to the constants
 * in types/stl_library.ts. The DB columns are plain varchars so we can grow
 * the enums without an ALTER TABLE; validation is enforced here at the
 * boundary instead.
 */

export const listStlFilesValidator = vine.compile(
  vine.object({
    category: vine.enum(STL_CATEGORIES).optional(),
    material: vine.enum(STL_MATERIALS).optional(),
    difficulty: vine.enum(STL_DIFFICULTIES).optional(),
    pending_metadata: vine.boolean().optional(),
    search: vine.string().trim().minLength(1).maxLength(200).optional(),
    page: vine.number().min(1).optional(),
    per_page: vine.number().min(1).max(200).optional(),
  })
)

export const idParamValidator = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
  })
)

/**
 * Update validator. Every field is optional so the same endpoint serves
 * "user supplied required metadata for the first time" (flips
 * metadata_pending → false in the controller) and "user tweaked one tag."
 * The controller is responsible for recomputing metadata_pending based on
 * the post-update state, not based on what the payload contains.
 */
export const updateStlFileValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    category: vine.enum(STL_CATEGORIES).optional(),
    tags: vine.array(vine.string().trim().minLength(1).maxLength(64)).optional(),
    material: vine.enum(STL_MATERIALS).nullable().optional(),
    print_time_minutes: vine.number().min(0).max(60 * 24 * 30).nullable().optional(), // cap at 30 days
    infill_pct: vine.number().min(0).max(100).nullable().optional(),
    difficulty: vine.enum(STL_DIFFICULTIES).nullable().optional(),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    source_url: vine.string().url().maxLength(512).nullable().optional(),
    license: vine.string().trim().maxLength(255).nullable().optional(),
  })
)
