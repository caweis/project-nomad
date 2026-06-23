import { useEffect, useRef, useState } from 'react'
import StyledButton from '~/components/StyledButton'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'

// One row in the overflow menu. `action` runs a callback and closes the menu;
// `toggle` is a labelled checkbox row that stays open so the flip is visible;
// `divider` separates the lifecycle/maintenance items from the destructive zone.
export type AppMenuItem =
  | {
      kind: 'action'
      icon: DynamicIconName
      label: string
      onClick: () => void
      disabled?: boolean
      // Renders the row in red (Delete, Wipe & reinstall) so the data-losing
      // actions read as dangerous and sit apart from the benign ones.
      danger?: boolean
    }
  | {
      kind: 'toggle'
      label: string
      checked: boolean
      onChange: (next: boolean) => void
      disabled?: boolean
    }
  | { kind: 'divider' }

export interface AppManageMenuProps {
  items: AppMenuItem[]
  // Disables the trigger while an install/operation is in flight.
  disabled?: boolean
}

// The single "⋯" overflow menu every Supply Depot row uses. A table row's
// actions column is too narrow to hold Open + Update + Stop/Start + Restart +
// the custom-app cluster + Wipe & reinstall on one line, so they wrap into a
// ragged three-high stack. Collapsing everything past Open (and a conditional
// Update) into this menu keeps each row on a single line. Used by BOTH surfaces
// — settings/apps.tsx (items open inline modals) and SupplyDepotCard.tsx (items
// call handlers.* props) — with identical behaviour; this is purely where the
// actions live, not what they do.
export default function AppManageMenu({ items, disabled }: AppManageMenuProps) {
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

  // Nothing to collapse (e.g. an installed app with unknown status and no custom
  // cluster) → render no trigger at all rather than an empty menu.
  if (items.length === 0) return null

  const itemBase =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div ref={containerRef} className="relative inline-flex">
      <StyledButton
        variant="neutral"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
      >
        <DynamicIcon icon="IconDots" className="h-4 w-4" />
      </StyledButton>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-md border border-desert-tan-lighter bg-white py-1 shadow-lg"
        >
          {items.map((item, i) => {
            if (item.kind === 'divider') {
              return (
                <div key={i} className="my-1 border-t border-desert-tan-lighter" aria-hidden />
              )
            }
            if (item.kind === 'toggle') {
              return (
                <label
                  key={i}
                  className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm text-desert-stone-dark hover:bg-desert-sand"
                >
                  {item.label}
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => item.onChange(e.target.checked)}
                    disabled={item.disabled}
                    className="accent-desert-orange h-4 w-4 rounded"
                  />
                </label>
              )
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`${itemBase} ${
                  item.danger
                    ? 'text-desert-red hover:bg-desert-red-light hover:text-desert-white'
                    : 'text-desert-stone-dark hover:bg-desert-sand'
                }`}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                disabled={item.disabled}
              >
                <DynamicIcon icon={item.icon} className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
