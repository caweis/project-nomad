import { useEffect, useRef, useState } from 'react'
import {
  IconDots,
  IconChevronDown,
  IconPencil,
  IconArrowUp,
  IconFileText,
  IconTrash,
} from '@tabler/icons-react'
import StyledButton from '~/components/StyledButton'

// Shared "Manage" dropdown for a custom Supply Depot app. Collapses the
// custom-app-only cluster (Edit / Pull latest / Logs / Auto-update toggle /
// Delete) that used to live as a row of inline buttons into a single neutral
// menu button. Used by BOTH surfaces:
//   - settings/apps.tsx (table rows) — callbacks open the same inline modals.
//   - components/SupplyDepotCard.tsx (cards) — callbacks call handlers.* props.
// Behaviour is identical to the old inline buttons; this is purely a visual /
// grouping reorganisation. Each menu item fires the SAME action and respects
// the same loading / online guards the inline buttons did.
export interface AppManageMenuProps {
  onEdit: () => void
  onPullLatest: () => void
  onViewLogs: () => void
  onDelete: () => void
  autoUpdateEnabled: boolean
  onToggleAutoUpdate: (enabled: boolean) => void
  // Mirrors the inline buttons' disabled conditions.
  loading: boolean
  isOnline: boolean
}

export default function AppManageMenu({
  onEdit,
  onPullLatest,
  onViewLogs,
  onDelete,
  autoUpdateEnabled,
  onToggleAutoUpdate,
  loading,
  isOnline,
}: AppManageMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Click-outside + Escape close the panel. Listeners only attach while open.
  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Run an action then close the menu, mirroring native menu dismissal.
  function runAndClose(action: () => void) {
    return () => {
      setOpen(false)
      action()
    }
  }

  const itemBase =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div ref={containerRef} className="relative inline-flex">
      <StyledButton
        icon="IconDots"
        variant="neutral"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Manage
        <IconChevronDown className="ml-1.5 h-4 w-4" />
      </StyledButton>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-md border border-desert-tan-lighter bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={`${itemBase} text-desert-stone-dark hover:bg-desert-sand`}
            onClick={runAndClose(onEdit)}
            disabled={loading}
          >
            <IconPencil className="h-4 w-4 shrink-0" />
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${itemBase} text-desert-stone-dark hover:bg-desert-sand`}
            onClick={runAndClose(onPullLatest)}
            disabled={loading || !isOnline}
          >
            <IconArrowUp className="h-4 w-4 shrink-0" />
            Pull latest
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${itemBase} text-desert-stone-dark hover:bg-desert-sand`}
            onClick={runAndClose(onViewLogs)}
            disabled={loading}
          >
            <IconFileText className="h-4 w-4 shrink-0" />
            Logs
          </button>
          {/* Auto-update lives in the menu as a labelled toggle row. Same
              onChange wiring as the old inline checkbox; clicking it does NOT
              close the menu so the user can see the state flip. */}
          <label className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm text-desert-stone-dark hover:bg-desert-sand">
            Auto-update
            <input
              type="checkbox"
              checked={autoUpdateEnabled}
              onChange={(e) => onToggleAutoUpdate(e.target.checked)}
              className="accent-desert-orange h-4 w-4 rounded"
            />
          </label>
          <div className="my-1 border-t border-desert-tan-lighter" aria-hidden />
          <button
            type="button"
            role="menuitem"
            className={`${itemBase} text-desert-red hover:bg-desert-red-light hover:text-desert-white`}
            onClick={runAndClose(onDelete)}
            disabled={loading}
          >
            <IconTrash className="h-4 w-4 shrink-0" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
