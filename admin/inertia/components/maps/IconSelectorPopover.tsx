import { useLayoutEffect, useRef, useState } from 'react'

import StyledButton from '~/components/StyledButton'
import { MARKER_ICONS } from './marker_icons'

const EDGE_MARGIN = 8

type IconSelectorPopoverProps = {
  selectedIcon?: string | null
  /** A name from MARKER_ICONS, or null for the plain pin. */
  onSelect: (iconName: string | null) => void
  onClose: () => void
}

/**
 * The marker icon picker: the whole curated set, six across and six down
 * (upstream 092762f5, with the width 0481e2e4 restored).
 *
 * No search box and no paging, because there is nothing to search or page
 * through -- 36 icons fit on screen at once, which is the point of curating
 * them. See marker_icons.ts for why the set is a hand-written list.
 *
 * Default pin puts the plain pin back. Upstream has no way back to it once an
 * icon has been picked.
 *
 * The grid opens below and to the right of its button, which would put part of
 * it off the page for a pin near the right or bottom edge. It measures itself
 * once on opening and moves back inside the window if it has to.
 */
export default function IconSelectorPopover({
  selectedIcon,
  onSelect,
  onClose,
}: IconSelectorPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Null until measured; the grid stays invisible until then, so it never flashes
  // half off the page.
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    // Measured a frame late on purpose. In the frame the grid is added, the map
    // popup around it is briefly wider (seen in Chromium) and so sits further
    // left, and a measurement taken then leaves the grid 54px short at the
    // right edge.
    const frame = requestAnimationFrame(() => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      // Move left or up just enough to fit, but never past the left or top edge.
      const x = Math.max(
        EDGE_MARGIN - rect.left,
        Math.min(0, window.innerWidth - EDGE_MARGIN - rect.right)
      )
      const y = Math.max(
        EDGE_MARGIN - rect.top,
        Math.min(0, window.innerHeight - EDGE_MARGIN - rect.bottom)
      )
      setOffset({ x, y })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-7 z-50 w-72 rounded-md border border-border-subtle bg-surface-primary p-2 shadow-lg"
      style={
        offset
          ? offset.x || offset.y
            ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
            : undefined
          : { visibility: 'hidden' }
      }
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-6 justify-items-center gap-1">
        {MARKER_ICONS.map(({ name, label, Icon }) => (
          <button
            key={name}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={selectedIcon === name}
            onClick={() => {
              onSelect(name)
              onClose()
            }}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-secondary ${
              selectedIcon === name ? 'bg-desert-green text-white' : 'text-text-secondary'
            }`}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>

      <div className="mt-2 flex justify-end gap-1.5">
        {selectedIcon && (
          <StyledButton
            size="sm"
            variant="outline"
            onClick={() => {
              onSelect(null)
              onClose()
            }}
          >
            Default pin
          </StyledButton>
        )}
        <StyledButton size="sm" variant="outline" onClick={onClose}>
          Close
        </StyledButton>
      </div>
    </div>
  )
}
