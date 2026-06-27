export interface MapRegionEntry {
  /** The on-disk filename, e.g. "washington_2025-12.pmtiles". */
  name: string
  /** Date-stripped region key, e.g. "washington". */
  regionName: string
  /** Version (YYYY-MM) parsed from the filename, or null for an undated legacy file. */
  version: string | null
}

/**
 * Compare two map-file versions (YYYY-MM, or null for an undated legacy file).
 * Returns >0 if `a` is newer than `b`, <0 if older, 0 if equal. A dated build is
 * always newer than an undated legacy file; two dated builds compare
 * lexicographically (correct for zero-padded YYYY-MM).
 */
export function compareMapVersions(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a < b ? -1 : 1
}

/**
 * Dedupe map files by region, keeping only the newest file per region.
 *
 * Both "washington.pmtiles" and "washington_2025-12.pmtiles" reduce to the
 * region "washington". Emitting both produces duplicate MapLibre source keys
 * (and duplicate layer ids downstream), which MapLibre rejects outright —
 * blanking the ENTIRE map, not just that region. Old copies linger when a newer
 * curated version installs, so this guard keeps the style valid even if on-disk
 * cleanup has not run.
 *
 * Returns the surviving entries (one per region). `onDuplicate(kept, dropped)`
 * is called for each replaced/skipped file so the caller can log it.
 *
 * Ported from upstream 9b84d3a (#634).
 */
export function pickNewestPerRegion(
  entries: MapRegionEntry[],
  onDuplicate?: (kept: MapRegionEntry, dropped: MapRegionEntry) => void
): MapRegionEntry[] {
  const bestByRegion = new Map<string, MapRegionEntry>()
  for (const entry of entries) {
    const existing = bestByRegion.get(entry.regionName)
    if (!existing) {
      bestByRegion.set(entry.regionName, entry)
      continue
    }
    if (compareMapVersions(entry.version, existing.version) > 0) {
      onDuplicate?.(entry, existing)
      bestByRegion.set(entry.regionName, entry)
    } else {
      onDuplicate?.(existing, entry)
    }
  }
  return Array.from(bestByRegion.values())
}
