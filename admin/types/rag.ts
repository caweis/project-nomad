export type EmbedJobWithProgress = {
  jobId: string
  fileName: string
  filePath: string
  progress: number
  status: string
  /** Present only on failed jobs — the BullMQ failure reason, surfaced so the
   *  Processing Queue can show WHICH file failed and WHY. */
  failedReason?: string
}

/**
 * One row of the Stored Files panel (RFC #883): the union of Qdrant sources
 * and state-machine-tracked files. `state` is null for a Qdrant source the
 * scanner hasn't recorded yet (pre-RFC data); `chunksEmbedded` mirrors the row
 * field; 0 for state-row-less or zero-chunk files.
 */
export type StoredFileInfo = {
  source: string
  state: import('./kb_ingest_state.js').KbIngestStateValue | null
  chunksEmbedded: number
  /** Filename portion of `source` (last path segment). */
  fileName: string
  /** File size in bytes from disk; null if the file is missing or unreadable. */
  size: number | null
  /** Last-modified timestamp from disk (ISO 8601); null if unavailable. */
  uploadedAt: string | null
  /** True when `source` lives under the user-uploads directory. Drives which
   * rows offer view/download in the UI. */
  isUserUpload: boolean
  /** Subject/category tag, or null if uncategorized. */
  collection: string | null
}

export type ProcessAndEmbedFileResponse = {
  success: boolean
  message: string
  chunks?: number
  hasMoreBatches?: boolean
  articlesProcessed?: number
  totalArticles?: number
}
export type ProcessZIMFileResponse = ProcessAndEmbedFileResponse

export type RAGResult = {
  text: string
  score: number
  keywords: string
  chunk_index: number
  created_at: number
  article_title?: string
  section_title?: string
  full_title?: string
  hierarchy?: string
  document_id?: string
  content_type?: string
  source?: string
}

export type RerankedRAGResult = Omit<RAGResult, 'keywords'> & {
  finalScore: number
}