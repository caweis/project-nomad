import { router } from '@inertiajs/react'
import { useState } from 'react'
import { IconSearch, IconX } from '@tabler/icons-react'
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryKind,
  InventoryListFilters,
} from '../../../types/inventory'

interface FilterEnum {
  categories: { value: InventoryCategory; label: string }[]
  conditions?: InventoryCondition[]
  kinds?: InventoryKind[]
}

interface Props {
  filters: InventoryListFilters
  enums: FilterEnum
  total: number
  /** Distinct known locations, alphabetized — options for the location select. */
  locations: string[]
}

/** "Expiring within N days" options for the filter dropdown. */
const EXPIRY_WINDOWS = [7, 14, 30, 60, 90] as const

/**
 * Filter rail for the Inventory tab of the Preparedness page. URL-driven —
 * every change is an Inertia visit to /readiness?tab=inventory so back/forward,
 * deep-links, and refresh all preserve filter state. Mirrors WorkshopFilters;
 * strips empty params from the URL.
 */
export default function InventoryFilters({ filters, enums, total, locations }: Props) {
  const [search, setSearch] = useState(filters.search ?? '')

  const updateFilter = (partial: Partial<InventoryListFilters>) => {
    const merged: Record<string, unknown> = { ...filters, ...partial, page: 1 }
    // Strip empty/false params so the URL stays clean (?category= → no param),
    // and narrow to the scalar shape Inertia's RequestPayload accepts. The
    // tab param keeps the visit on the Inventory tab of the Preparedness page.
    const next: Record<string, string | number | boolean> = { tab: 'inventory' }
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === null || v === '' || v === false) continue
      next[k] = v as string | number | boolean
    }
    router.get('/readiness', next, { preserveState: true, preserveScroll: true, replace: true })
  }

  const clearAll = () =>
    router.get('/readiness', { tab: 'inventory' }, { preserveState: true })

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilter({ search: search.trim() || undefined })
  }

  const hasActiveFilters =
    !!filters.category ||
    !!filters.kind ||
    !!filters.condition ||
    !!filters.location ||
    !!filters.search ||
    filters.expiring_within_days !== undefined ||
    filters.low_stock === true

  return (
    <aside className="w-full md:w-64 shrink-0 p-4 bg-white border-r border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Filters</h2>
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-desert-green"
          >
            <IconX size={14} /> Clear
          </button>
        )}
      </div>

      <div className="text-xs text-gray-500 mb-4">
        {total.toLocaleString()} item{total === 1 ? '' : 's'} match
      </div>

      <form onSubmit={onSearchSubmit} className="mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Search name</label>
        <div className="flex gap-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="item name"
            className="flex-1 min-w-0 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            aria-label="Search"
            className="rounded border border-gray-300 bg-gray-50 px-2 hover:bg-gray-100"
          >
            <IconSearch size={16} />
          </button>
        </div>
      </form>

      <FilterGroup label="Category">
        <select
          value={filters.category ?? ''}
          onChange={(e) =>
            updateFilter({ category: (e.target.value || undefined) as InventoryCategory | undefined })
          }
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">All categories</option>
          {enums.categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </FilterGroup>

      {enums.kinds && enums.kinds.length > 0 && (
        <FilterGroup label="Kind">
          <select
            value={filters.kind ?? ''}
            onChange={(e) =>
              updateFilter({ kind: (e.target.value || undefined) as InventoryKind | undefined })
            }
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm capitalize"
          >
            <option value="">All kinds</option>
            {enums.kinds.map((k) => (
              <option key={k} value={k} className="capitalize">
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </FilterGroup>
      )}

      {enums.conditions && enums.conditions.length > 0 && (
        <FilterGroup label="Condition">
          <select
            value={filters.condition ?? ''}
            onChange={(e) =>
              updateFilter({ condition: (e.target.value || undefined) as InventoryCondition | undefined })
            }
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm capitalize"
          >
            <option value="">All conditions</option>
            {enums.conditions.map((c) => (
              <option key={c} value={c} className="capitalize">
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </FilterGroup>
      )}

      <FilterGroup label="Location">
        {/* A select of known locations — picking one issues the same Inertia GET
            (?location=...) the old free-text field did; the backend whereILike on
            `location` is unchanged. "All locations" clears the filter. */}
        <select
          value={filters.location ?? ''}
          onChange={(e) => updateFilter({ location: e.target.value || undefined })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">All locations</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup label="Expiring within">
        <select
          value={filters.expiring_within_days ?? ''}
          onChange={(e) =>
            updateFilter({
              expiring_within_days: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">Any expiry</option>
          {EXPIRY_WINDOWS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup label="Stock">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={filters.low_stock === true}
            onChange={(e) => updateFilter({ low_stock: e.target.checked ? true : undefined })}
          />
          Only low stock
        </label>
      </FilterGroup>
    </aside>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
