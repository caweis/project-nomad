import { useState } from 'react'
import {
  IconCheckbox,
  IconTrash,
  IconX,
  IconAlertTriangle,
} from '@tabler/icons-react'
import type {
  StlCategory,
  StlDifficulty,
  StlMaterial,
} from '../../../types/stl_library'

type BatchAction = 'update-metadata' | 'recategorize' | 'delete'

interface BatchEnums {
  categories: { value: StlCategory; label: string }[]
  materials: StlMaterial[]
  difficulties: StlDifficulty[]
}

interface Props {
  selectedCount: number
  pageCount: number
  allOnPageSelected: boolean
  enums: BatchEnums
  /** Toggle "select every file on this page" on/off. */
  onSelectAllOnPage: () => void
  onClearSelection: () => void
  /**
   * Run a batch op. Resolves to an error string on failure, or null on
   * success. The bar shows the error inline and keeps the selection so the
   * user can retry; the parent clears selection + reloads on success.
   */
  onRun: (action: BatchAction, fields: BatchFields) => Promise<string | null>
}

export interface BatchFields {
  material?: StlMaterial | null
  difficulty?: StlDifficulty | null
  category?: StlCategory
}

/**
 * Floating action bar shown when ≥1 file is selected in the Workshop grid.
 * Drives the three batch actions: set material, set difficulty, recategorize,
 * and delete. Each dropdown fires its op immediately on change (then resets to
 * its placeholder); delete confirms first.
 *
 * Styling mirrors the rest of Workshop — desert-green primary, gray borders,
 * Tabler icons, small text — so it reads as part of the same surface.
 */
export default function WorkshopBatchBar({
  selectedCount,
  pageCount,
  allOnPageSelected,
  enums,
  onSelectAllOnPage,
  onClearSelection,
  onRun,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: BatchAction, fields: BatchFields) => {
    setBusy(true)
    setError(null)
    const err = await onRun(action, fields)
    if (err) setError(err)
    setBusy(false)
  }

  const onDelete = async () => {
    const confirmed = window.confirm(
      `Delete ${selectedCount} file${selectedCount === 1 ? '' : 's'}?\n\n` +
        `This removes the files from disk AND the catalog. Cannot be undone ` +
        `except by re-importing the files.`
    )
    if (!confirmed) return
    await run('delete', {})
  }

  return (
    <div className="sticky top-0 z-30 mb-3 rounded-lg border border-desert-green bg-white shadow-md">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-desert-green">
          <IconCheckbox size={18} />
          {selectedCount} selected
        </span>

        <button
          type="button"
          onClick={onSelectAllOnPage}
          className="text-xs text-gray-600 hover:text-desert-green underline-offset-2 hover:underline"
        >
          {allOnPageSelected ? 'Deselect page' : `Select all on page (${pageCount})`}
        </button>

        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-desert-green"
        >
          <IconX size={14} /> Clear selection
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Set material */}
          <select
            aria-label="Set material for selected files"
            disabled={busy}
            value=""
            onChange={(e) => {
              const v = e.target.value
              e.currentTarget.selectedIndex = 0
              if (v) void run('update-metadata', { material: v as StlMaterial })
            }}
            className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">Set material…</option>
            {enums.materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* Set difficulty */}
          <select
            aria-label="Set difficulty for selected files"
            disabled={busy}
            value=""
            onChange={(e) => {
              const v = e.target.value
              e.currentTarget.selectedIndex = 0
              if (v) void run('update-metadata', { difficulty: v as StlDifficulty })
            }}
            className="rounded border border-gray-300 px-2 py-1 text-sm capitalize disabled:opacity-50"
          >
            <option value="">Set difficulty…</option>
            {enums.difficulties.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          {/* Recategorize */}
          <select
            aria-label="Recategorize selected files"
            disabled={busy}
            value=""
            onChange={(e) => {
              const v = e.target.value
              e.currentTarget.selectedIndex = 0
              if (v) void run('recategorize', { category: v as StlCategory })
            }}
            className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">Move to category…</option>
            {enums.categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          {/* Delete */}
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded border border-red-300 px-2.5 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <IconTrash size={16} /> Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
