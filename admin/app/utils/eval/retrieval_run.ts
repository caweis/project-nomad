import { basename, extname } from 'node:path'
// Type-only, so it uses the .js specifier tsc expects and is erased before
// node ever tries to resolve it — the same trick setting_value.ts relies on.
import type { ScoredChunk } from './retrieval_metrics.js'

/**
 * Turning what RagService.searchSimilarDocuments returns into what the
 * retrieval metrics score.
 *
 * Pure, and imports only node: builtins, so it runs under bare
 * `node --experimental-strip-types` like the rest of the eval utilities.
 *
 * Ported from upstream #1233's corpus_source.ts, adapted. Upstream resolves a
 * chunk's `source` against a frozen corpus directory (tests/eval/corpus) and
 * treats anything outside it as un-resolvable, which is how it proves its
 * collection filter held. This fork's retrieval eval runs against a knowledge
 * base collection the operator already indexed, so there is no corpus directory
 * to contain sources to and no honest equivalent of that check. What survives
 * is the accounting: every chunk that cannot be resolved to a document is
 * counted and reported, so a run whose sources look wrong is visible rather
 * than quietly depressing precision.
 */

/** The retrieved shape RagService actually returns. */
export type RetrievedChunk = {
  text: string
  score: number
  metadata?: Record<string, any>
}

/**
 * A chunk's document id: the basename of its `source` payload without the
 * extension, which is the same key `updateFileCollection` filters on.
 *
 * Returns null when `source` is missing or not a string. A null id still
 * occupies a rank in the chunk-level metrics but cannot be credited to any
 * document, which is what makes the unresolved count meaningful.
 */
export function docIdFromSource(source: unknown): string | null {
  if (typeof source !== 'string') return null
  const trimmed = source.trim()
  if (trimmed === '') return null
  const base = basename(trimmed)
  if (base === '' || base === '.' || base === '..') return null
  const ext = extname(base)
  const id = ext ? base.slice(0, -ext.length) : base
  return id === '' ? null : id
}

export type MappedRetrieval = {
  chunks: ScoredChunk[]
  /** Chunks whose `source` could not be resolved to a document id. */
  unresolved: number
}

/**
 * Map a ranked retrieval result onto the scoring shape, preserving order.
 * Order is the whole point: every rank-sensitive metric reads it.
 */
export function toScoredChunks(retrieved: RetrievedChunk[]): MappedRetrieval {
  let unresolved = 0
  const chunks = retrieved.map((r) => {
    const docId = docIdFromSource(r.metadata?.source)
    if (docId === null) unresolved++
    return { docId, score: r.score }
  })
  return { chunks, unresolved }
}

/**
 * The retrieval parameters that decide whether two reports can be compared.
 *
 * Upstream hashes the corpus itself. This fork cannot: it never ingested the
 * documents. These are the inputs it can honestly account for, and the compare
 * step refuses to read a difference across reports whose stamps disagree —
 * otherwise "I changed the threshold" and "I changed the chunking" look
 * identical in the numbers.
 */
export type RunStamp = {
  collection: string
  embeddingModel: string
  topK: number
  scoreThreshold: number
}

export function stampsMatch(a: RunStamp, b: RunStamp): boolean {
  return (
    a.collection === b.collection &&
    a.embeddingModel === b.embeddingModel &&
    a.topK === b.topK &&
    a.scoreThreshold === b.scoreThreshold
  )
}

export function describeStamp(s: RunStamp): string {
  return `collection=${s.collection} model=${s.embeddingModel} k=${s.topK} threshold=${s.scoreThreshold}`
}
