/**
 * Whether a batched ZIM ingestion should dispatch a continuation.
 *
 * The pure core of the batch loop in `RagService.processZIMFile`, in the same
 * shape as `decideScanAction` in `kb_ingest_decision.ts`. Import-free, so it
 * runs under bare `node --experimental-strip-types`.
 *
 * The signal MUST be the number of articles the extractor *consumed*, never the
 * number that produced chunks. An article yields no chunks whenever its text is
 * empty after HTML cleaning (redirect stubs, category listings, image and video
 * wrappers, PDF containers). Those are ordinary ZIM entries, and they are
 * invisible to any count derived from the returned chunks.
 *
 * Gating on a chunk-derived count ends ingestion the first time a window of
 * `batchSize` articles happens to be mostly empty: no continuation is
 * dispatched, and the rest of the archive is skipped without a word. That is
 * the norm, not an edge case, for scraped-site and media-heavy archives, which
 * usually open with navigation pages. Upstream measured Medicine LibreTexts at
 * 16 chunks from 23,171 articles and WikiMed at 28% of its articles.
 *
 * `articlesProcessed < batchSize` means the extractor's iterator ran dry, the
 * only reliable end-of-archive signal: `archive.articleCount` cannot bound it,
 * because `iterByPath()` yields more article entries than that figure for some
 * archives. A full final batch costs one extra dispatch that extracts nothing
 * and stops, which is cheap next to stopping one batch early.
 *
 * Ported from upstream 1933f8ee.
 */
export interface ZimBatchProgress {
  /** Articles the extractor consumed in this batch, not articles that produced chunks. */
  articlesProcessed: number
  /** The article ceiling requested for this batch. */
  batchSize: number
}

export function hasMoreArticleBatches({ articlesProcessed, batchSize }: ZimBatchProgress): boolean {
  return articlesProcessed >= batchSize
}
