export type ReindexOutcome =
  | 'not_a_replacement'
  | 'qdrant_not_installed'
  | 'old_not_indexed'
  | 'qdrant_not_running'
  | 'reindex'

export interface ContentReindexInput {
  isReplacement: boolean
  qdrantInstalled: boolean
  oldFileWasIndexed: boolean
  qdrantRunning: boolean
}

/** Preserve the old file's indexing choice when a new edition replaces it. */
export function decideContentReindex(input: ContentReindexInput): ReindexOutcome {
  if (!input.isReplacement) return 'not_a_replacement'
  if (!input.qdrantInstalled) return 'qdrant_not_installed'
  if (!input.oldFileWasIndexed) return 'old_not_indexed'
  if (!input.qdrantRunning) return 'qdrant_not_running'
  return 'reindex'
}

export type DownloadIngestDecision = 'skip' | 'purge_old' | 'reconcile' | 'pending' | 'embed'

/** Choose post-download KB work without letting the global policy override an older choice. */
export function decideDownloadIngest(
  qdrantInstalled: boolean,
  skipEmbedding: boolean,
  isReplacement: boolean,
  policy: 'Always' | 'Manual'
): DownloadIngestDecision {
  if (!qdrantInstalled) return 'skip'
  if (skipEmbedding) return isReplacement ? 'purge_old' : 'skip'
  if (isReplacement) return 'reconcile'
  return policy === 'Manual' ? 'pending' : 'embed'
}
