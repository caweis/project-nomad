// Type-only, so it uses the .js specifier tsc expects and is erased before node
// ever tries to resolve it (the same arrangement as retrieval_run.ts).
import type { CatalogLanguage } from '../../types/zim.js'

/**
 * The Kiwix catalog's language feed, as fast-xml-parser hands it back, turned
 * into the languages Content Explorer can offer.
 *
 * The feed is the catalog's own list (/catalog/v2/languages), so every option
 * is one that can actually be browsed and each carries a real book count. The
 * labels are the catalog's endonyms, "français" and "中文", which is what someone
 * scanning for their own language recognises. Sorted by book count, most first.
 *
 * Anything unusable is dropped rather than shown: an entry with no code, a code
 * the list endpoint's validator would refuse, or no books behind it. An option
 * the user can pick and then get a 422 or an empty page from is worse than one
 * fewer option.
 *
 * Pure, so it runs under bare `node --experimental-strip-types`.
 * Ported from upstream dde8aa55, which parses inline in ZimService.
 */

/** What the list endpoint accepts: an ISO-639 code, or `all` (see validators/zim.ts). */
export const CATALOG_LANGUAGE_PATTERN = /^(all|[a-z]{2,8})$/

export function parseCatalogLanguages(parsed: unknown): CatalogLanguage[] {
  const entry = (parsed as any)?.feed?.entry
  const rawEntries: unknown[] = entry ? (Array.isArray(entry) ? entry : [entry]) : []

  const languages: CatalogLanguage[] = []
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    // `dc:language` is the ISO-639-3 code; `thr:count` is how many books carry it.
    const code = typeof record['dc:language'] === 'string' ? record['dc:language'].trim() : ''
    const label = record.title
    const bookCount = Number(record['thr:count'])
    if (!code || code === 'all' || !CATALOG_LANGUAGE_PATTERN.test(code)) continue
    if (!Number.isFinite(bookCount) || bookCount <= 0) continue
    languages.push({
      code,
      label: typeof label === 'string' && label.trim() ? label.trim() : code,
      book_count: bookCount,
    })
  }

  return languages.sort((a, b) => b.book_count - a.book_count)
}
