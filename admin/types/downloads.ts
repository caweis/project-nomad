export type DoResumableDownloadParams = {
  url: string
  filepath: string
  timeout: number
  allowedMimeTypes: string[]
  signal?: AbortSignal
  onProgress?: (progress: DoResumableDownloadProgress) => void
  onComplete?: (url: string, path: string) => void | Promise<void>
  forceNew?: boolean
  /** Re-run post-download work for a verified final file after a failed job. */
  resumeCompletion?: boolean
  /**
   * Extra HTTP request headers sent on BOTH the HEAD probe and the GET stream.
   * Used for gated self-hosted curated content (upstream #1172) to carry the
   * `Authorization: Bearer <key>` an entitlement server requires; the Range
   * header still composes on top for resumed downloads. Kept generic so any
   * gated source can reuse it. (Upstream's carrier is Creator Packs — a
   * feature this fork does not ship.)
   */
  requestHeaders?: Record<string, string>
}

export type DoResumableDownloadWithRetryParams = DoResumableDownloadParams & {
  max_retries?: number
  retry_delay?: number
  onAttemptError?: (error: Error, attempt: number) => void
}

export type DoResumableDownloadProgress = {
  downloadedBytes: number
  totalBytes: number
  lastProgressTime: number
  lastDownloadedBytes: number
  url: string
}

export type RunDownloadJobParams = Omit<
  DoResumableDownloadParams,
  'onProgress' | 'onComplete' | 'signal'
> & {
  filetype: string
  resourceMetadata?: {
    resource_id: string
    version: string
    collection_ref: string | null
    /** True when this download was triggered by content auto-update — drives the
     * per-resource backoff success/failure recording in the job + worker. */
    auto?: boolean
    /** Video and other browse-only ZIMs must not enter the AI knowledge base. */
    skip_embedding?: boolean
  }
  /** Persisted by the worker before it changes the installed-resource row. */
  completionContext?: {
    oldFilePath: string | null
    oldFileWasIndexed: boolean
    ingestDecision: 'skip' | 'purge_old' | 'reconcile' | 'pending' | 'embed'
  }
  completionDone?: boolean
}

export type DownloadJobWithProgress = {
  jobId: string
  url: string
  progress: number
  filepath: string
  filetype: string
  status?: 'active' | 'failed'
  failedReason?: string
}

// Wikipedia selector types
export type WikipediaOption = {
  id: string
  name: string
  description: string
  size_mb: number
  url: string | null
}

export type WikipediaCurrentSelection = {
  optionId: string
  status: 'none' | 'downloading' | 'installed' | 'failed'
  filename: string | null
  url: string | null
}

export type WikipediaState = {
  options: WikipediaOption[]
  currentSelection: WikipediaCurrentSelection | null
}
