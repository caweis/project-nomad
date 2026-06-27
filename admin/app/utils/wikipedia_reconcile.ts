/**
 * True when a ZIM file on disk is the single general-Wikipedia file managed by
 * the WikipediaSelection model — the one file the curated-ZIM reconcile loop
 * should skip.
 *
 * The old reconcile loop skipped EVERY file whose name started with
 * `wikipedia_en_`. That also caught curated category-tier ZIMs like
 * `wikipedia_en_medicine_maxi`, so their InstalledResource row was never
 * written and got wiped on every restart — silently downgrading the detected
 * tier. Matching the exact managed filename instead lets those tier ZIMs
 * reconcile normally, while still excluding the user-selected general-Wikipedia
 * file from the curated path. A null/empty selection skips nothing.
 *
 * Ported from upstream df47139 (#774).
 */
export function isManagedWikipediaFile(name: string, managedFilename: string | null): boolean {
  return !!managedFilename && name === managedFilename
}
