/**
 * Workshop maker-library — file classification helpers.
 *
 * Pure module (no Lucid / HTTP imports) so it can be unit-tested without
 * booting the AdonisJS container. Mirrors the embed_jobs.ts / drug_labels.ts
 * pattern.
 *
 * Covers:
 *   • classifyFileType(ext)  — extension → WorkshopFileType | null
 *   • INDEXABLE_EXTS         — the full set of extensions the scanner walks
 *   • isMetadataComplete()   — type-aware completeness check
 *   • CATEGORY_REMAP         — old 7-category → new 14-category migration map
 */

export type WorkshopFileType = 'stl' | 'cad' | 'pdf' | 'image'

/**
 * Canonical map from normalised extension (leading dot, lowercase) to
 * WorkshopFileType. Add new extensions here; INDEXABLE_EXTS is derived.
 */
const EXT_MAP: Record<string, WorkshopFileType> = {
  '.stl': 'stl',
  '.3mf': 'stl',
  '.step': 'cad',
  '.stp': 'cad',
  '.dxf': 'cad',
  '.dwg': 'cad',
  '.f3d': 'cad',
  '.scad': 'cad',
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
}

/**
 * All extensions the scanner will index — the union of EXT_MAP keys.
 * Used by StlScannerService.walkLibrary() and upload validation.
 */
export const INDEXABLE_EXTS: ReadonlySet<string> = new Set(Object.keys(EXT_MAP))

/**
 * Classify a file extension to a WorkshopFileType.
 *
 * Accepts extensions with or without the leading dot, in any case.
 * Returns null for unknown extensions (scanner skips; upload rejects).
 *
 * @example
 *   classifyFileType('.STL')   // 'stl'
 *   classifyFileType('pdf')    // 'pdf'
 *   classifyFileType('.docx')  // null
 */
export function classifyFileType(ext: string): WorkshopFileType | null {
  // Normalise: lowercase, ensure leading dot.
  const normalised = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return EXT_MAP[normalised] ?? null
}

/**
 * Type-aware metadata-completeness check.
 *
 *   stl  → name + material + print_time_minutes > 0 + difficulty (existing rule)
 *   else → non-empty name only (cad / pdf / image have no rich print metadata)
 *
 * StlFile.isMetadataComplete() is a thin wrapper over this so existing callers
 * continue to work without changes.
 */
export function isMetadataComplete(row: {
  file_type: string
  name?: string | null
  material?: string | null
  print_time_minutes?: number | null
  difficulty?: string | null
}): boolean {
  const hasName = !!row.name && row.name.trim().length > 0

  if (row.file_type === 'stl') {
    return (
      hasName &&
      !!row.material &&
      row.print_time_minutes !== null &&
      row.print_time_minutes !== undefined &&
      row.print_time_minutes > 0 &&
      !!row.difficulty
    )
  }

  // cad / pdf / image — named is sufficient.
  return hasName
}

/**
 * Data-migration map for the 7 → 14 category rename.
 *
 * Only two old values require a rename; the other five are valid in both the
 * old and new sets (medical, replacement-parts, household, firearm-accessories,
 * other). The migration UPDATE runs through this map; the unit test covers all
 * 7 old values so nothing is accidentally dropped.
 */
export const CATEGORY_REMAP: Record<string, string> = {
  tools: 'tools-hardware',
  agriculture: 'agriculture-homestead',
}
