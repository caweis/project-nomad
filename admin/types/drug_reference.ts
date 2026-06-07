/**
 * Drug Reference v1 — types.
 *
 * Enums, DTOs, and manifest types for the openFDA drug-label feature.
 * All server → client data transfer shapes are defined here.
 */

// ─── Product type ─────────────────────────────────────────────────────────────

export const PRODUCT_TYPES = {
  OTC: 'HUMAN OTC DRUG',
  RX: 'HUMAN PRESCRIPTION DRUG',
} as const

export type ProductType = (typeof PRODUCT_TYPES)[keyof typeof PRODUCT_TYPES]

// ─── Manifest (from api.fda.gov/download.json) ────────────────────────────────

export interface DrugLabelPartition {
  display_name: string
  file: string        // full URL to the .zip
  size_mb: string     // string in the JSON
  records: number
}

export interface DrugLabelManifest {
  export_date: string
  total_records: number
  partitions: DrugLabelPartition[]
}

// ─── Job params ───────────────────────────────────────────────────────────────

export interface IngestDrugLabelsJobParams {
  partIndex?: number
  manifest?: DrugLabelManifest
  totalParts?: number
  recordsIngested?: number
  recordsSkipped?: number
  /** Epoch ms when the ingest began (set on pass 0, carried through continuations). */
  startedAt?: number
}

// ─── Search result DTO (collapsed by brand+generic) ──────────────────────────

/**
 * Slim result row — one per distinct (brand_name, generic_name) pair.
 * `id` is a representative row id for the detail view; `labelCount` tells
 * the UI how many individual FDA set_ids collapsed into this result.
 */
export interface DrugSearchResult {
  id: number
  brand_name: string | null
  generic_name: string | null
  manufacturer: string | null
  route: string | null
  product_type: string | null
  labelCount: number
}

// ─── Detail DTO (full label body) ─────────────────────────────────────────────

export interface DrugLabelDetail {
  id: number
  set_id: string
  spl_id: string | null
  version: string | null
  brand_name: string | null
  generic_name: string | null
  manufacturer: string | null
  product_ndc: string | null
  route: string | null
  product_type: string | null
  indications: string | null
  dosage: string | null
  warnings: string | null
  boxed_warning: string | null
  drug_interactions: string | null
  contraindications: string | null
  when_using: string | null
  stop_use: string | null
  source_updated_at: string | null
  ingested_at: string
}

// ─── Ingest status ────────────────────────────────────────────────────────────

export type DrugIngestPhase =
  | 'manifest'
  | 'downloading'
  | 'ingesting'
  | 'completed'
  | 'failed'

export type DrugIngestState = 'idle' | 'running' | 'completed' | 'failed'

export interface DrugIngestStatus {
  state: DrugIngestState
  progress: number
  phase: DrugIngestPhase
  partIndex: number
  totalParts: number
  currentPartName: string | null
  recordsIngested: number
  recordsSkipped: number
  /** Approx. total records from the manifest (0 if not known yet). Drives the counter + %. */
  expectedTotal: number
  /** Epoch ms the ingest began, for live elapsed + a rough ETA (null if idle/unknown). */
  startedAtMs: number | null
  failedReason?: string
  lastUpdated: string | null
  rowCount: number
}
