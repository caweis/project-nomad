/**
 * Drug Reference v1 — pure, unit-testable helpers.
 *
 * NO Lucid / AdonisJS / HTTP imports. These take plain objects and return plain
 * objects so they run under @japa/runner without booting MySQL or Redis.
 * Mirrors the `embed_jobs.ts` pattern.
 */

import type { DrugLabelManifest, DrugLabelPartition } from '../types/drug_reference.js'

// ─── Internal structural types (no Lucid) ────────────────────────────────────

/**
 * Structural shape of an openFDA label record — only the fields we care about.
 * Declared locally (no Lucid imports) so the mapper stays pure.
 */
export interface OpenFdaLabelRecord {
  set_id?: string
  id?: string
  version?: string
  effective_time?: string
  openfda?: {
    brand_name?: string[]
    generic_name?: string[]
    manufacturer_name?: string[]
    product_ndc?: string[]
    route?: string[]
    product_type?: string[]
  }
  indications_and_usage?: string[]
  dosage_and_administration?: string[]
  warnings?: string[]
  boxed_warning?: string[]
  drug_interactions?: string[]
  contraindications?: string[]
  when_using?: string[]
  stop_use?: string[]
}

/** Plain row object that matches the DrugLabel Lucid model's column shape. */
export interface DrugLabelRow {
  set_id: string
  spl_id: string | null
  version: string | null
  brand_name: string | null
  generic_name: string | null
  manufacturer: string | null
  product_ndc: string | null
  route: string | null
  product_type: string | null
  searchable_name: string | null
  indications: string | null
  dosage: string | null
  warnings: string | null
  boxed_warning: string | null
  drug_interactions: string | null
  contraindications: string | null
  when_using: string | null
  stop_use: string | null
  source_updated_at: string | null // ISO date YYYY-MM-DD or null
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Flatten a section array: join with "\n\n", trim. An absent key or an empty
 * array both return null (no empty strings).
 */
function flattenSection(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null
  const joined = arr.join('\n\n').trim()
  return joined.length > 0 ? joined : null
}

/**
 * Return the first element of an array, or null if absent/empty.
 */
function firstOf(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null
  return arr[0] ?? null
}

/**
 * Join an array with ", ", or null if absent/empty.
 */
function joinOf(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null
  const joined = arr.join(', ').trim()
  return joined.length > 0 ? joined : null
}

/**
 * Parse openFDA effective_time (YYYYMMDD) to ISO date YYYY-MM-DD.
 * Returns null for missing, non-string, or invalid formats.
 */
function parseEffectiveTime(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  // Must be exactly 8 digits
  if (!/^\d{8}$/.test(raw)) return null
  const year = raw.slice(0, 4)
  const month = raw.slice(4, 6)
  const day = raw.slice(6, 8)
  const y = parseInt(year, 10)
  const m = parseInt(month, 10)
  const d = parseInt(day, 10)
  // Basic sanity check: year in a plausible FDA range, month 1–12, day 1–31
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${year}-${month}-${day}`
}

/**
 * Truncate a string to a maximum length (the drug_labels varchar column widths).
 * openFDA joins multi-value fields — e.g. every active ingredient into
 * generic_name — which can exceed a column's width; clamping here keeps the row
 * insertable so one over-long value never fails (and drops) its whole 500-row
 * upsert batch. Section bodies are mediumtext and are never clamped.
 */
function clamp(value: string | null, max: number): string | null {
  if (value === null) return null
  return value.length > max ? value.slice(0, max) : value
}

/** drug_labels varchar column widths — must match the migration. */
const COL = {
  SET_ID: 64,
  SPL_ID: 64,
  VERSION: 16,
  BRAND: 255,
  GENERIC: 512,
  MANUFACTURER: 512,
  PRODUCT_NDC: 255,
  ROUTE: 255,
  PRODUCT_TYPE: 32,
  SEARCHABLE: 768,
} as const

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Map a raw openFDA label record to a flat DrugLabelRow for upsert.
 *
 * Returns null when the record lacks a usable `set_id` (the idempotency key) —
 * the ingest pipeline skips those and increments `recordsSkipped`.
 *
 * Varchar-bound fields are length-clamped to their column widths so an over-long
 * value can't fail the batch upsert. All section fields are optional (they are
 * absent keys in many records, not empty arrays — verified on live OTC records).
 */
export function mapDrugLabelRecord(record: OpenFdaLabelRecord): DrugLabelRow | null {
  if (!record.set_id || record.set_id.trim() === '') return null
  const setId = record.set_id.trim()
  // set_id is the UNIQUE idempotency key — never truncate it (a truncated key
  // could collide with a different label). openFDA set_ids are 36-char GUIDs, so
  // this guard is defensive, not an expected path.
  if (setId.length > COL.SET_ID) return null

  const brand = firstOf(record.openfda?.brand_name)
  const generic = joinOf(record.openfda?.generic_name)

  return {
    set_id: setId,
    spl_id: clamp(record.id ?? null, COL.SPL_ID),
    version: clamp(record.version ?? null, COL.VERSION),
    brand_name: clamp(brand, COL.BRAND),
    generic_name: clamp(generic, COL.GENERIC),
    manufacturer: clamp(firstOf(record.openfda?.manufacturer_name), COL.MANUFACTURER),
    product_ndc: clamp(joinOf(record.openfda?.product_ndc), COL.PRODUCT_NDC),
    route: clamp(joinOf(record.openfda?.route), COL.ROUTE),
    product_type: clamp(firstOf(record.openfda?.product_type), COL.PRODUCT_TYPE),
    searchable_name: clamp(normalizeDrugName(brand, generic), COL.SEARCHABLE),
    indications: flattenSection(record.indications_and_usage),
    dosage: flattenSection(record.dosage_and_administration),
    warnings: flattenSection(record.warnings),
    boxed_warning: flattenSection(record.boxed_warning),
    drug_interactions: flattenSection(record.drug_interactions),
    contraindications: flattenSection(record.contraindications),
    when_using: flattenSection(record.when_using),
    stop_use: flattenSection(record.stop_use),
    source_updated_at: parseEffectiveTime(record.effective_time),
  }
}

/**
 * Normalize brand + generic names into a searchable blob.
 *
 * Combines the two strings, lowercases, strips non-alphanumeric characters
 * to spaces, collapses whitespace runs, deduplicates tokens (preserving order),
 * and trims. Both null/empty → null.
 *
 * Example: ("Tylenol Extra Strength", "acetaminophen") → "tylenol extra strength acetaminophen"
 * Example: ("Silicea", "SILICEA") → "silicea" (deduped)
 */
export function normalizeDrugName(
  brand: string | null,
  generic: string | null
): string | null {
  const parts: string[] = []
  if (brand && brand.trim().length > 0) parts.push(brand.trim())
  if (generic && generic.trim().length > 0) parts.push(generic.trim())
  if (parts.length === 0) return null

  const combined = parts.join(' ')
  // Lowercase, replace non-alphanumeric with space
  const normalized = combined.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  // Split into tokens, deduplicate preserving first occurrence order
  const rawTokens = normalized.split(/\s+/).filter((t) => t.length > 0)
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const token of rawTokens) {
    if (!seen.has(token)) {
      seen.add(token)
      deduped.push(token)
    }
  }

  const result = deduped.join(' ').trim()
  return result.length > 0 ? result : null
}

/**
 * Parse the download.json manifest into a typed DrugLabelManifest.
 *
 * Throws a descriptive error if:
 *   - `results.drug.label` is missing (manifest shape changed upstream)
 *   - The `partitions` array is absent or empty
 *
 * Partitions missing a `file` field are skipped with a warning logged to
 * stderr so the caller can decide whether to abort.
 *
 * @param json - The parsed JSON object from GET https://api.fda.gov/download.json
 */
export function parseDrugLabelManifest(json: unknown): DrugLabelManifest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Unexpected FDA manifest format: root is not an object')
  }

  const root = json as Record<string, unknown>
  const results = root['results'] as Record<string, unknown> | undefined
  if (!results || typeof results !== 'object') {
    throw new Error('Unexpected FDA manifest format: missing "results"')
  }

  const drug = results['drug'] as Record<string, unknown> | undefined
  if (!drug || typeof drug !== 'object') {
    throw new Error('Unexpected FDA manifest format: missing "results.drug"')
  }

  const label = drug['label'] as Record<string, unknown> | undefined
  if (!label || typeof label !== 'object') {
    throw new Error('Unexpected FDA manifest format: missing "results.drug.label"')
  }

  const export_date = label['export_date']
  if (typeof export_date !== 'string' || export_date.trim() === '') {
    throw new Error('Unexpected FDA manifest format: missing or invalid "export_date"')
  }

  const total_records = label['total_records']
  if (typeof total_records !== 'number') {
    throw new Error('Unexpected FDA manifest format: missing or invalid "total_records"')
  }

  const rawPartitions = label['partitions']
  if (!Array.isArray(rawPartitions) || rawPartitions.length === 0) {
    throw new Error(
      'Unexpected FDA manifest format: "partitions" is missing or empty'
    )
  }

  const partitions: DrugLabelPartition[] = []
  for (const p of rawPartitions as unknown[]) {
    if (typeof p !== 'object' || p === null) {
      process.stderr.write('[parseDrugLabelManifest] Skipping non-object partition\n')
      continue
    }
    const part = p as Record<string, unknown>
    if (typeof part['file'] !== 'string' || (part['file'] as string).trim() === '') {
      process.stderr.write(
        `[parseDrugLabelManifest] Skipping partition with missing "file": ${JSON.stringify(part)}\n`
      )
      continue
    }
    partitions.push({
      display_name: typeof part['display_name'] === 'string' ? part['display_name'] : '',
      file: (part['file'] as string).trim(),
      size_mb: typeof part['size_mb'] === 'string' ? part['size_mb'] : '0',
      records: typeof part['records'] === 'number' ? part['records'] : 0,
    })
  }

  if (partitions.length === 0) {
    throw new Error(
      'Unexpected FDA manifest format: all partitions were invalid (missing "file" field)'
    )
  }

  return {
    export_date: export_date.trim(),
    total_records,
    partitions,
  }
}
