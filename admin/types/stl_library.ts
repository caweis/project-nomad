/**
 * Workshop / Offline STL Library — shared enums and TypeScript types.
 *
 * Ported from SysAdminDoc/project-nomad-desktop §50 "Offline STL Library."
 * Files live on disk under ${NOMAD_DATA_ROOT}/storage/stl-library/<category>/.
 * The DB row indexes them; the file is the source of truth.
 *
 * v1 broaden (Workshop-broaden #6): categories expanded 7 → 14; file_type
 * discriminator added to slim/detail interfaces; WORKSHOP_FILE_TYPES added.
 */

export const STL_CATEGORIES = [
  'tools-hardware',
  'replacement-parts',
  'household',
  'medical',
  'agriculture-homestead',
  'woodworking',
  'electronics',
  'automotive',
  'outdoor-survival',
  'toys-games',
  'art-decor',
  'firearm-accessories',
  'education-models',
  'other',
] as const

export type StlCategory = (typeof STL_CATEGORIES)[number]

/** File-type discriminator for the broadened Workshop maker library. */
export const WORKSHOP_FILE_TYPES = ['stl', 'cad', 'pdf', 'image'] as const
export type WorkshopFileTypeEnum = (typeof WORKSHOP_FILE_TYPES)[number]

export const STL_MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'Resin', 'Nylon'] as const

export type StlMaterial = (typeof STL_MATERIALS)[number]

export const STL_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const

export type StlDifficulty = (typeof STL_DIFFICULTIES)[number]

/**
 * What a category looks like in the UI — the human-friendly label for the
 * filter sidebar, dropdowns, and card badges.
 *
 * Updated from 7 → 14 categories for Workshop-broaden v1 (#6).
 */
export const CATEGORY_LABELS: Record<StlCategory, string> = {
  'tools-hardware': 'Tools & Hardware',
  'replacement-parts': 'Replacement Parts',
  household: 'Household',
  medical: 'Medical',
  'agriculture-homestead': 'Agriculture & Homestead',
  woodworking: 'Woodworking',
  electronics: 'Electronics',
  automotive: 'Automotive',
  'outdoor-survival': 'Outdoor & Survival',
  'toys-games': 'Toys & Games',
  'art-decor': 'Art & Decor',
  'firearm-accessories': 'Firearm Accessories',
  'education-models': 'Education & Models',
  other: 'Other',
}

/**
 * Slim representation returned by list endpoints — omits long fields like
 * `description` so a 1000-item grid doesn't ship 100kb of text.
 */
export interface StlFileSlim {
  id: number
  path: string
  name: string
  /** Discriminator added in Workshop-broaden v1 (#6). */
  file_type: WorkshopFileTypeEnum
  category: StlCategory
  material: StlMaterial | null
  print_time_minutes: number | null
  difficulty: StlDifficulty | null
  thumbnail_path: string | null
  thumbnail_failed: boolean
  metadata_pending: boolean
  file_size_bytes: number
}

/**
 * Full record returned by the detail endpoint.
 *
 * Intentionally omits `pdf_text_extract`: it can be up to 20 KB and is only
 * needed when the user opens the PDF-text disclosure, so the detail view
 * lazy-fetches it from `/api/workshop/files/:id/pdf-text` instead of shipping
 * it in this payload. The page surfaces a `has_pdf_text` boolean to decide
 * whether to offer that disclosure.
 */
export interface StlFileDetail extends StlFileSlim {
  tags: string[]
  infill_pct: number | null
  description: string | null
  source_url: string | null
  license: string | null
  file_hash: string | null
  added_at: string
  last_indexed_at: string
}

/**
 * Filter query accepted by the list endpoint.
 */
export interface StlListFilters {
  file_type?: WorkshopFileTypeEnum
  category?: StlCategory
  material?: StlMaterial
  difficulty?: StlDifficulty
  pending_metadata?: boolean
  search?: string
  page?: number
  per_page?: number
}

/**
 * Returned by the list endpoint when the data drive holding the library is
 * unplugged — same UX pattern as Kiwix when its drive is out.
 */
export interface StlLibraryUnavailable {
  available: false
  reason: 'drive_disconnected' | 'library_root_missing'
  library_root: string
}
