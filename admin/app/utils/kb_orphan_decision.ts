import { sep } from 'node:path'

/**
 * The pure core of the knowledge base orphan sweep (caweis#50).
 *
 * `scanAndSyncStorage` already builds both halves of the answer in one pass:
 * `sourcesInQdrant` from a facet query, and the embeddable files found by
 * walking storage. It only ever asked one direction — "is this file on disk
 * already embedded?" — and never the reverse, "does this Qdrant source still
 * have a file behind it?".
 *
 * Nothing else asked either. `ZimService.delete` removes the file, the Kiwix
 * library entry and the `installed_resources` row without touching Qdrant, so
 * a deleted ZIM's passages stayed retrievable in chat, and a replaced file left
 * its old points sitting beside the new ones. On a box with no internet, an
 * answer drawn from content the user deleted is not something they can check
 * against anything else.
 *
 * Only `node:path` is imported, which keeps this runnable under bare
 * `node --experimental-strip-types` for the standalone tests.
 *
 * Ported from upstream #1227 (their issue #1170), which this fork's scan has
 * the same gap in, with the per-root guards from their #1393.
 */

/**
 * Past this share of a root's indexed sources, a single sync refuses to purge
 * that root at all. Losing most of a root at once is far likelier to mean the
 * root points somewhere wrong (a different disk, a stale copy, a half-finished
 * data-path move per #1050) than that the user deleted most of their library
 * by hand. Deletions and content updates purge their own vectors as they happen
 * (ZimService.delete, deleteFileBySource, and RunDownloadJob for a replaced
 * ZIM), so the sweep only ever mops up stragglers and has no business removing
 * the bulk of a root.
 */
export const ORPHAN_PURGE_MAX_FRACTION = 0.5

/**
 * The mass-removal guard only engages once this many sources would go. Below
 * it, the fraction is too noisy to mean anything (1 of 2 is 50%) and the cost
 * of a wrong purge is a few minutes of re-embedding, not hours.
 */
export const ORPHAN_PURGE_MIN_GUARDED = 5

export type WithheldOrphans = {
  /** Scan root whose orphans were left in place. */
  root: string
  /** How many indexed sources under it would have been purged. */
  count: number
  /**
   * `empty_root`: the root was walked but held no embeddable files.
   * `mass_removal`: the purge would remove more than ORPHAN_PURGE_MAX_FRACTION
   * of the root's indexed sources.
   */
  reason: 'empty_root' | 'mass_removal'
}

export type OrphanDecision = {
  /** Sources safe to purge. */
  orphans: string[]
  /** Roots whose missing sources were held back, for the operator to see. */
  withheld: WithheldOrphans[]
}

export type OrphanInput = {
  /** Every source Qdrant holds, including ones outside the scanned roots. */
  sourcesInQdrant: string[]
  /**
   * Every file the scan found, embeddable or not. This is the evidence that a
   * source still has a file behind it.
   *
   * Deliberately not the embeddable list. The question is "does a file still
   * exist on disk", not "would we choose to embed it today": if
   * determineFileType ever stops recognising a type it used to accept, the
   * narrower list would call every already-embedded file of that type an
   * orphan and delete its vectors.
   */
  filesOnDisk: string[]
  /**
   * The subset of `filesOnDisk` that would be embedded. This is the evidence
   * that a root holds content at all, and it has to be this list rather than
   * `filesOnDisk` (#1378): Kiwix regenerates kiwix-library.xml in an empty
   * mountpoint, so a root that failed to mount still has entries.
   */
  embeddableFiles: string[]
  /** The roots the scan actually walked, not the roots it meant to walk. */
  scannedRoots: string[]
}

/**
 * Decision for the reverse sweep in `RagService.scanAndSyncStorage`.
 *
 * Decided per scanned root, because the roots fail independently. Two guards
 * apply to each, and either one withholds the whole root for this cycle:
 *
 * 1. A root with no embeddable files keeps its sources (#1378). Walking a
 *    directory successfully does not prove it holds the content: boot runs
 *    ensureDirectoryExists() on the zim root, so a separate volume that failed
 *    to mount leaves a real, empty mountpoint behind. An empty root is
 *    indistinguishable from an unmounted one, and a single upload in
 *    kb_uploads is enough to make the overall scan non-empty.
 *
 * 2. A purge that would remove more than ORPHAN_PURGE_MAX_FRACTION of a
 *    root's indexed sources (and at least ORPHAN_PURGE_MIN_GUARDED of them) is
 *    withheld. This catches the root pointing at the wrong place while still
 *    holding a few files, which guard 1 can't see.
 *
 * Both guards trade a missed cleanup for safety: re-embedding a wrongly purged
 * library takes hours to days, while a stale source costs nothing until the
 * next sync or an explicit delete from the knowledge base panel.
 *
 * With no roots scanned there is nothing to decide, which is the right reading
 * of "we couldn't see any of the storage": it never reads as "nothing is on
 * disk, so purge everything".
 */
export function decideOrphans(input: OrphanInput): OrphanDecision {
  const { sourcesInQdrant, filesOnDisk, embeddableFiles, scannedRoots } = input
  const onDisk = new Set(filesOnDisk)
  const orphans = new Set<string>()
  const withheld: WithheldOrphans[] = []

  for (const root of scannedRoots) {
    const indexed = filterOrphanCandidates(sourcesInQdrant, [root])
    const missing = indexed.filter((source) => !onDisk.has(source))
    if (missing.length === 0) continue

    if (filterOrphanCandidates(embeddableFiles, [root]).length === 0) {
      withheld.push({ root, count: missing.length, reason: 'empty_root' })
      continue
    }

    if (
      missing.length >= ORPHAN_PURGE_MIN_GUARDED &&
      missing.length / indexed.length > ORPHAN_PURGE_MAX_FRACTION
    ) {
      withheld.push({ root, count: missing.length, reason: 'mass_removal' })
      continue
    }

    for (const source of missing) orphans.add(source)
  }

  return { orphans: [...orphans], withheld }
}

/**
 * What to tell the person who pressed Sync when roots were left alone: one
 * clause per root, appended to the sync message. Empty when nothing was
 * withheld. `label` turns a root into something they can recognise.
 */
export function describeWithheld(
  withheld: WithheldOrphans[],
  label: (root: string) => string
): string {
  return withheld
    .map(
      (w) =>
        `; left ${w.count} indexed source${w.count !== 1 ? 's' : ''} under ${label(w.root)} untouched because ${
          w.reason === 'empty_root'
            ? 'that folder has no files (is the drive mounted?)'
            : 'removing them would clear most of that folder (is it pointing at the right drive? If the files were removed on purpose, delete them under Stored Knowledge Base Files)'
        }`
    )
    .join('')
}

/**
 * Narrow paths down to the ones under a root the disk scan genuinely walked:
 * the roots it listed on this pass, not the roots it meant to list.
 * decideOrphans() applies it per root, both to Qdrant sources and to the files
 * found on disk.
 *
 * This guard is load-bearing, not defensive dressing, twice over.
 *
 * NOMAD embeds its own bundled documentation into the same knowledge base
 * (`discoverNomadDocs`), and those files live outside both scan roots. Without
 * this filter the first sweep would find every one of them "missing from disk"
 * and purge the product's own docs out of the knowledge base.
 *
 * And the scan skips a root that is not there rather than failing, because a
 * fresh install has no kb_uploads until the first upload. A missing zim root
 * next to a kb_uploads with files in it still yields a non-empty file list, so
 * if the configured roots were passed here every ZIM in the index would be an
 * orphan purged in one batch: hours of re-embedding, from pressing Sync. Only
 * walked roots are passed, so a missing one contributes no candidates. (A root
 * that was walked but is empty is the same problem one step removed;
 * decideOrphans' per-root guard handles that, see #1378.) (Upstream f8a29693.)
 *
 * Filtering by scanned root rather than by a list of known-safe names means a
 * future embedding source added outside these roots is left alone by default
 * instead of being reaped the first time it appears.
 */
export function filterOrphanCandidates(
  sourcesInQdrant: string[],
  scannedRoots: string[]
): string[] {
  const prefixes = scannedRoots
    // A trailing separator matters: without it "/storage/zim-backup" shares a
    // string prefix with "/storage/zim" and would be swept.
    .filter((p) => typeof p === 'string' && p !== '')
    .map((p) => (p.endsWith(sep) ? p : p + sep))

  if (prefixes.length === 0) return []

  return sourcesInQdrant.filter((source) => prefixes.some((prefix) => source.startsWith(prefix)))
}
