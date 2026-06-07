/**
 * Workshop pagination — pure page-list builder.
 *
 * Given the current page and the last page, return the compact sequence of
 * page numbers (and `'…'` gap markers) the pager should render. Always shows
 * the first and last page, plus a window of pages around the current one, so a
 * 200-page library doesn't render 200 buttons.
 *
 * Declared as a pure function (no React / DOM imports) so the index page can
 * call it AND a unit test can exercise the edge cases without a browser,
 * mirroring the embed_jobs.ts helper pattern.
 *
 * Examples (default siblings=1, boundaries=1):
 *   pageList(1, 1)    → [1]
 *   pageList(3, 5)    → [1, 2, 3, 4, 5]
 *   pageList(1, 10)   → [1, 2, '…', 10]
 *   pageList(5, 10)   → [1, '…', 4, 5, 6, '…', 10]
 *   pageList(10, 10)  → [1, '…', 9, 10]
 */

export type PageToken = number | '…'

export interface PageListOptions {
  /** Pages to show on each side of the current page. Default 1. */
  siblings?: number
  /** Pages pinned at each end (first/last). Default 1. */
  boundaries?: number
}

export function pageList(current: number, last: number, opts: PageListOptions = {}): PageToken[] {
  const siblings = Math.max(0, opts.siblings ?? 1)
  const boundaries = Math.max(1, opts.boundaries ?? 1)

  // Guard nonsense input: at least one page exists.
  const lastPage = Math.max(1, Math.floor(last))
  // Clamp current into [1, lastPage].
  const cur = Math.min(Math.max(1, Math.floor(current)), lastPage)

  // When the whole range would fit in the space the ellipsis version occupies,
  // just render every page — an ellipsis that hides nothing (or only the page
  // it replaces) is pure noise. The threshold mirrors the standard pager math
  // (MUI/Mantine usePagination): two boundary blocks + the sibling window on
  // each side + the current page + the two ellipsis slots.
  const fullThreshold = boundaries * 2 + siblings * 2 + 3
  if (lastPage <= fullThreshold) {
    return Array.from({ length: lastPage }, (_, i) => i + 1)
  }

  // Collect the set of pages we definitely want to show.
  const pages = new Set<number>()

  // Boundary pages at the start and end.
  for (let i = 1; i <= Math.min(boundaries, lastPage); i++) pages.add(i)
  for (let i = Math.max(1, lastPage - boundaries + 1); i <= lastPage; i++) pages.add(i)

  // The window around the current page.
  for (let i = Math.max(1, cur - siblings); i <= Math.min(lastPage, cur + siblings); i++) {
    pages.add(i)
  }

  const sorted = [...pages].sort((a, b) => a - b)

  // Walk the sorted unique pages, inserting a single '…' wherever there's a gap.
  // A gap of exactly 1 (e.g. [3, 5]) is collapsed to the literal missing page
  // instead of an ellipsis — an ellipsis hiding one number wastes space.
  const tokens: PageToken[] = []
  let prev = 0
  for (const page of sorted) {
    if (prev !== 0) {
      const gap = page - prev
      if (gap === 2) {
        tokens.push(prev + 1)
      } else if (gap > 2) {
        tokens.push('…')
      }
    }
    tokens.push(page)
    prev = page
  }

  return tokens
}
