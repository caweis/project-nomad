// Supply Depot category grouping — pure helper shared by the card page
// (inertia/pages/settings/supply-depot.tsx via SupplyDepotCard) and its
// standalone test. No React / DOM / Inertia imports so it strip-runs under
// `node --experimental-strip-types` for the gate test.

// Minimal shape this helper needs off a service row. ServiceSlim (see
// inertia/../types/services.ts) is a superset; typing to just these two fields
// keeps the helper testable with plain fixtures and free of the Lucid model.
// Both fields mirror the Service model's nullability (category and
// display_order are both `| null` there), so ServiceSlim satisfies this shape
// and groupServicesByCategory<ServiceSlim>(...) infers cleanly.
export interface GroupableService {
  category: string | null
  display_order: number | null
}

export interface ServiceGroup<T extends GroupableService> {
  category: string
  label: string
  services: T[]
}

// Bucket used when a service has no category (null / empty / whitespace).
export const OTHER_CATEGORY = 'other'

// Display order of the known category buckets. Anything not listed here is an
// "unknown" category and is appended after these, alphabetically, with OTHER
// last of all. Mirrors the catalog's category vocabulary in the service seeder.
export const CATEGORY_ORDER: readonly string[] = [
  'ai',
  'productivity',
  'utility',
  'education',
  'networking',
  'security',
]

// Human-facing section headers. Unknown categories fall back to a Title-cased
// version of the raw key (see labelForCategory).
export const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  productivity: 'Productivity',
  utility: 'Utilities',
  education: 'Education',
  networking: 'Networking',
  security: 'Security',
  [OTHER_CATEGORY]: 'Other',
}

// Title-cases an unknown category key (e.g. 'home-automation' -> 'Home Automation').
function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function labelForCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? titleCase(category)
}

// Normalises a row's category to a bucket key: null / empty / whitespace -> OTHER.
function bucketKey(category: string | null): string {
  const trimmed = (category ?? '').trim()
  return trimmed.length > 0 ? trimmed : OTHER_CATEGORY
}

// Rank used to sort the resulting groups. Known categories sort to their fixed
// CATEGORY_ORDER position; unknown categories sort after all known ones
// (alphabetically among themselves); OTHER sorts dead last.
function categoryRank(category: string): number {
  if (category === OTHER_CATEGORY) return Number.MAX_SAFE_INTEGER
  const idx = CATEGORY_ORDER.indexOf(category)
  // Unknown categories: after the known block, before OTHER. The +1 keeps them
  // ahead of OTHER (which is MAX_SAFE_INTEGER); ties broken by name below.
  return idx === -1 ? CATEGORY_ORDER.length : idx
}

/**
 * Groups services by category into ordered sections.
 *
 * - Known categories sort to their fixed CATEGORY_ORDER position.
 * - Unknown (not-in-order) categories are appended after the known block,
 *   alphabetically among themselves.
 * - A null / empty / whitespace category is bucketed as OTHER, which sorts last.
 * - Within each group, services keep ascending display_order (stable for ties).
 * - Empty groups are never emitted (only categories present in the input appear).
 *
 * Pure: returns new arrays, does not mutate the input.
 */
export function groupServicesByCategory<T extends GroupableService>(
  services: readonly T[]
): ServiceGroup<T>[] {
  const buckets = new Map<string, T[]>()

  for (const service of services) {
    const key = bucketKey(service.category)
    const existing = buckets.get(key)
    if (existing) {
      existing.push(service)
    } else {
      buckets.set(key, [service])
    }
  }

  const groups: ServiceGroup<T>[] = []
  for (const [category, rows] of buckets) {
    // Stable ascending display_order. Array.prototype.sort is stable (ES2019+),
    // so rows with equal display_order keep their input (insertion) order. A
    // null display_order sorts as 0 (catalog rows always carry one; this only
    // guards the model's nominal nullability).
    const ord = (s: T) => s.display_order ?? 0
    const sorted = [...rows].sort((a, b) => ord(a) - ord(b))
    groups.push({ category, label: labelForCategory(category), services: sorted })
  }

  groups.sort((a, b) => {
    const rankDelta = categoryRank(a.category) - categoryRank(b.category)
    if (rankDelta !== 0) return rankDelta
    // Same rank => unknown categories sharing the fallback rank; order by name.
    return a.category.localeCompare(b.category)
  })

  return groups
}
