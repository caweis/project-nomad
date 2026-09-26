// Type-only, so it uses the .js specifier tsc expects and is erased before node
// ever tries to resolve it (the same arrangement as retrieval_run.ts).
import type { ChatSource } from '../../types/chat.js'

/**
 * The "Sources" list shown under an assistant answer (upstream #1179).
 *
 * Offline there is no second opinion to check an answer against, so where a
 * claim came from is the only provenance the user gets. A wrong citation is
 * worse than none: it lends a real document's weight to an answer that was not
 * drawn from it.
 *
 * Pure, so it runs under bare `node --experimental-strip-types`.
 */

/**
 * Build the deduplicated list from what was *injected* into the prompt, never
 * from everything retrieval returned. A chunk trimmed out before the model saw
 * it did not inform the answer, and citing it would credit the answer to a
 * document it was not based on.
 *
 * Dedupes on the originating path so a dozen chunks out of one archive collapse
 * to one entry, falling back to the title when a point carries no path. Points
 * with neither are skipped rather than shown as "Unknown source": an entry the
 * user cannot act on makes an answer look sourced when it is not.
 */
export function buildCitations(docs: { metadata?: Record<string, any> }[]): ChatSource[] {
  const seen = new Set<string>()
  const sources: ChatSource[] = []

  for (const doc of docs) {
    const title =
      doc.metadata?.archive_title || doc.metadata?.full_title || doc.metadata?.article_title
    const path = typeof doc.metadata?.source === 'string' ? doc.metadata.source : undefined
    const key = path || title
    if (!key || seen.has(key)) continue
    seen.add(key)

    const date = doc.metadata?.archive_date
    sources.push({
      // A user-uploaded PDF carries no embedded title, so fall back to its
      // filename, which is what the user named it and will recognise.
      title: title || path!.split('/').pop() || path!,
      // Absent rather than undefined, so a list built live and the same list
      // read back from the database are the same shape.
      ...(typeof date === 'string' && date !== '' ? { date } : {}),
      ...(path ? { source: path } : {}),
    })
  }

  return sources
}

/**
 * Read a message's stored sources back, or undefined when there are none.
 *
 * Fork addition. Upstream JSON.parses the column bare inside the session
 * loader, so one malformed value would fail the whole conversation's load. A
 * citation list is worth less than the conversation it annotates: anything
 * unreadable is dropped, and entries without a title are skipped as they are
 * when the list is built.
 */
export function parseStoredSources(raw: string | null | undefined): ChatSource[] | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined

  const sources: ChatSource[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry.title !== 'string' || entry.title === '') continue
    sources.push({
      title: entry.title,
      ...(typeof entry.date === 'string' ? { date: entry.date } : {}),
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
    })
  }
  return sources.length > 0 ? sources : undefined
}
