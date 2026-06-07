import { router } from '@inertiajs/react'
import { useState } from 'react'
import { IconSearch, IconX } from '@tabler/icons-react'
import type { StlCategory, StlDifficulty, StlListFilters, StlMaterial, WorkshopFileTypeEnum } from '../../../types/stl_library'

const FILE_TYPE_LABELS: Record<WorkshopFileTypeEnum, string> = {
  stl: 'STL / 3MF',
  cad: 'CAD',
  pdf: 'PDF',
  image: 'Image',
}

interface FilterEnum {
  file_types: WorkshopFileTypeEnum[]
  categories: { value: StlCategory; label: string }[]
  materials: StlMaterial[]
  difficulties: StlDifficulty[]
}

interface Props {
  filters: StlListFilters
  enums: FilterEnum
  total: number
}

/**
 * Filter rail for the Workshop list page. Drives the URL — every change
 * does a partial Inertia visit so the back button works, deep-links work,
 * and a refresh preserves the user's filter state.
 */
export default function WorkshopFilters({ filters, enums, total }: Props) {
  const [search, setSearch] = useState(filters.search ?? '')

  const updateFilter = (partial: Partial<StlListFilters>) => {
    const next: Record<string, unknown> = { ...filters, ...partial, page: 1 }
    // Strip undefined / null / empty so the URL stays clean (?category= → no param)
    Object.keys(next).forEach((k) => {
      const v = next[k]
      if (v === undefined || v === null || v === '') delete next[k]
    })
    router.get('/workshop', next, { preserveState: true, preserveScroll: true, replace: true })
  }

  const clearAll = () => router.get('/workshop', {}, { preserveState: true })

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilter({ search: search.trim() || undefined })
  }

  const hasActiveFilters =
    !!filters.file_type ||
    !!filters.category ||
    !!filters.material ||
    !!filters.difficulty ||
    filters.pending_metadata !== undefined ||
    !!filters.search

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
        {total.toLocaleString()} file{total === 1 ? '' : 's'} match
      </div>

      <form onSubmit={onSearchSubmit} className="mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
        <div className="flex gap-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name or description"
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

      <FilterGroup label="File type">
        <select
          value={filters.file_type ?? ''}
          onChange={(e) =>
            updateFilter({
              file_type: (e.target.value || undefined) as WorkshopFileTypeEnum | undefined,
            })
          }
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">All types</option>
          {enums.file_types.map((ft) => (
            <option key={ft} value={ft}>
              {FILE_TYPE_LABELS[ft]}
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup label="Category">
        <select
          value={filters.category ?? ''}
          onChange={(e) =>
            updateFilter({ category: (e.target.value || undefined) as StlCategory | undefined })
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

      <FilterGroup label="Material">
        <select
          value={filters.material ?? ''}
          onChange={(e) =>
            updateFilter({ material: (e.target.value || undefined) as StlMaterial | undefined })
          }
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">Any material</option>
          {enums.materials.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup label="Difficulty">
        <select
          value={filters.difficulty ?? ''}
          onChange={(e) =>
            updateFilter({ difficulty: (e.target.value || undefined) as StlDifficulty | undefined })
          }
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm capitalize"
        >
          <option value="">Any difficulty</option>
          {enums.difficulties.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup label="Status">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={filters.pending_metadata === true}
            onChange={(e) => updateFilter({ pending_metadata: e.target.checked ? true : undefined })}
          />
          Only files needing metadata
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
