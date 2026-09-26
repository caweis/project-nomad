// Type-only, so it uses the .js specifier tsc expects and is erased before node
// ever tries to resolve it (the same arrangement as retrieval_run.ts).
import type { RerankedRAGResult } from '../../types/rag.js'

/**
 * Heading-match boost for a reranked RAG result.
 *
 * A query keyword appearing in a chunk's section/article heading is a strong
 * relevance signal that body-text matching alone misses. The boost is
 * conservative and score-scaled (same shape as the keyword/direct-term boosts):
 * sqrt(headingHitRatio) * 0.1 * score, so it re-orders already-retrieved chunks
 * and can't promote a weak match. Returns 0 when there's no heading or no hit.
 *
 * Ported from upstream b8961d2.
 */
export function computeHeadingBoost(
  headingText: string,
  queryKeywords: string[],
  score: number
): number {
  if (!headingText) return 0
  const lower = headingText.toLowerCase()
  const hits = queryKeywords.filter((kw) => lower.includes(kw.toLowerCase())).length
  if (hits === 0) return 0
  const ratio = hits / Math.max(queryKeywords.length, 1)
  return Math.sqrt(ratio) * 0.1 * score
}

/**
 * Per-block label for a context chunk injected into the RAG system prompt.
 *
 * Uses the source title when available, and NEVER the raw relevance score:
 * nomic-embed cosine scores for genuinely-relevant passages sit around
 * 0.4–0.6, so surfacing e.g. "42%" primes a small model to distrust correct
 * context. The score still goes to the logs for debugging.
 *
 * Ported from upstream b8961d2.
 */
export function buildContextLabel(
  index: number,
  metadata?: { full_title?: string; article_title?: string }
): string {
  const title = metadata?.full_title || metadata?.article_title
  return title ? `[Context ${index + 1} — ${title}]` : `[Context ${index + 1}]`
}

/**
 * Render retrieved chunks into the block the `rag_context` system prompt wraps.
 *
 * Lives here rather than beside the budgeting helpers in `rag_prompt.ts`
 * because it needs `buildContextLabel`, and `rag_prompt.ts` has to stay
 * import-free to remain runnable under bare `node --experimental-strip-types`
 * (see the note in that file). Keeping it next to the label rule also means
 * there is exactly one place that decides how a context block is presented.
 *
 * Extracted from OllamaController.chat unchanged (upstream #1233 shape).
 */
export function buildContextBlock(
  docs: { text: string; metadata?: { full_title?: string; article_title?: string } }[]
): string {
  return docs
    .map((doc, idx) => `${buildContextLabel(idx, doc.metadata)}\n${doc.text}`)
    .join('\n\n')
}

/**
 * What searchSimilarDocuments hands back for one reranked chunk.
 *
 * `source` is the originating file or ZIM path. Every point stores it, and it is
 * the only field that maps a chunk back to its document: eval:retrieval credits
 * recall by it. It used to be dropped here, which left every retrieved chunk
 * unresolvable and would have had the retrieval eval report zero recall against
 * any golden set. Upstream returns it (#1233); the fork's port of that harness
 * missed the line.
 */
export function toRetrievedChunk(result: RerankedRAGResult) {
  return {
    text: result.text,
    score: result.finalScore,
    metadata: {
      chunk_index: result.chunk_index,
      created_at: result.created_at,
      semantic_score: result.score,
      source: result.source,
      // Enhanced ZIM metadata (likely undefined for non-ZIM content)
      article_title: result.article_title,
      section_title: result.section_title,
      full_title: result.full_title,
      hierarchy: result.hierarchy,
      document_id: result.document_id,
      content_type: result.content_type,
      // Citation metadata (upstream #1179)
      archive_title: result.archive_title,
      archive_date: result.archive_date,
    },
  }
}
