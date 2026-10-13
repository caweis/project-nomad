import { sep } from 'node:path'

/** A single sweep must not remove most of a root's indexed sources. */
export const ORPHAN_PURGE_MAX_FRACTION = 0.5
/** Ignore the fraction for small cleanups, where one deletion skews it. */
export const ORPHAN_PURGE_MIN_GUARDED = 5

export type WithheldOrphans = {
  root: string
  count: number
  reason: 'empty_root' | 'mass_removal'
}

export type OrphanDecision = {
  orphans: string[]
  withheld: WithheldOrphans[]
}

/**
 * A root is only eligible if this scan actually walked it. A present but
 * empty folder is not proof its volume is mounted: boot creates the ZIM
 * directory even when an external drive is absent. An unexpectedly large
 * purge under a partly populated root is withheld for the same reason.
 *
 * Use every file found on disk to decide whether an indexed source still
 * exists. A file type that is no longer embeddable must not be purged merely
 * because the current classifier does not recognize it.
 */
export function decideOrphans(input: {
  sourcesInQdrant: string[]
  filesOnDisk: string[]
  embeddableFiles: string[]
  scannedRoots: string[]
}): OrphanDecision {
  const onDisk = new Set(input.filesOnDisk)
  const orphans: string[] = []
  const withheld: WithheldOrphans[] = []

  for (const root of new Set(input.scannedRoots)) {
    const indexed = filterOrphanCandidates(input.sourcesInQdrant, [root])
    const missing = indexed.filter((source) => !onDisk.has(source))
    if (missing.length === 0) continue

    if (filterOrphanCandidates(input.embeddableFiles, [root]).length === 0) {
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

    orphans.push(...missing)
  }

  return { orphans, withheld }
}

/**
 * Only paths below a walked root can be called missing. The trailing separator
 * keeps sibling names such as /storage/zim-backup out of /storage/zim.
 * Bundled NOMAD docs live outside both storage roots and stay untouched.
 */
export function filterOrphanCandidates(sources: string[], scannedRoots: string[]): string[] {
  const prefixes = scannedRoots
    .filter((root) => typeof root === 'string' && root !== '')
    .map((root) => (root.endsWith(sep) ? root : root + sep))

  if (prefixes.length === 0) return []
  return sources.filter((source) => prefixes.some((prefix) => source.startsWith(prefix)))
}
