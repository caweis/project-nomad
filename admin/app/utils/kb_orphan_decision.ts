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
 * the same gap in.
 */

/**
 * Which Qdrant sources have no file behind them any more.
 *
 * Returns `null` — meaning "do nothing this cycle" — when the disk scan came
 * back empty. An empty file list is indistinguishable from a filesystem hiccup
 * or a storage mount that has not come up yet, and wrongly reaping a healthy
 * knowledge base is far worse than skipping one sweep. The caller must treat
 * `null` as "no information", never as "no orphans".
 */
export function decideOrphans(
  sourcesInQdrant: string[],
  embeddableFiles: string[]
): string[] | null {
  if (embeddableFiles.length === 0) return null

  const onDisk = new Set(embeddableFiles)
  return sourcesInQdrant.filter((source) => !onDisk.has(source))
}

/**
 * Narrow Qdrant's sources to the ones the disk scan can actually speak for:
 * those under the roots it walked.
 *
 * This guard is load-bearing, not defensive dressing. NOMAD embeds its own
 * bundled documentation into the same knowledge base (`discoverNomadDocs`), and
 * those files live outside both scan roots. Without this filter the first sweep
 * would find every one of them "missing from disk" and purge the product's own
 * docs out of the knowledge base.
 *
 * Filtering by scanned root rather than by a list of known-safe names means a
 * future embedding source added outside these roots is left alone by default
 * instead of being reaped the first time it appears.
 */
export function filterOrphanCandidates(
  sourcesInQdrant: string[],
  scanRoots: { kbUploadsPath: string; zimPath: string }
): string[] {
  const prefixes = [scanRoots.kbUploadsPath, scanRoots.zimPath]
    // A trailing separator matters: without it "/storage/zim-backup" shares a
    // string prefix with "/storage/zim" and would be swept.
    .filter((p) => typeof p === 'string' && p !== '')
    .map((p) => (p.endsWith(sep) ? p : p + sep))

  if (prefixes.length === 0) return []

  return sourcesInQdrant.filter((source) => prefixes.some((prefix) => source.startsWith(prefix)))
}
