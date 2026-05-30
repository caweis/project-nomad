/**
 * Workshop / Offline STL Library — shared enums and TypeScript types.
 *
 * Ported from SysAdminDoc/project-nomad-desktop §50 "Offline STL Library."
 * Files live on disk under ${NOMAD_DATA_ROOT}/storage/stl-library/<category>/.
 * The DB row indexes them; the file is the source of truth.
 */

export const STL_CATEGORIES = [
  'medical',
  'tools',
  'household',
  'replacement-parts',
  'agriculture',
  'firearm-accessories',
  'other',
] as const

export type StlCategory = (typeof STL_CATEGORIES)[number]

export const STL_MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'Resin', 'Nylon'] as const

export type StlMaterial = (typeof STL_MATERIALS)[number]

export const STL_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const

export type StlDifficulty = (typeof STL_DIFFICULTIES)[number]

/**
 * What a category looks like in the UI — the human-friendly label and a
 * one-sentence description for the rights modal, empty state, and tooltips.
 */
export const CATEGORY_LABELS: Record<StlCategory, string> = {
  medical: 'Medical',
  tools: 'Tools',
  household: 'Household',
  'replacement-parts': 'Replacement Parts',
  agriculture: 'Agriculture',
  'firearm-accessories': 'Firearm Accessories',
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
