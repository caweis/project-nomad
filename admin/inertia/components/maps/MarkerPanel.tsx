import { useEffect, useMemo, useState } from 'react'
import {
  IconEye,
  IconEyeOff,
  IconMapPin,
  IconMapPinFilled,
  IconTrash,
  IconX,
} from '@tabler/icons-react'

import StyledButton from '~/components/StyledButton'
import type { MapMarker } from '~/hooks/useMapMarkers'
import { resolvePinColor, sortDirectionLabel, sortMarkers } from '~/util/map_markers'
import type { MarkerSortField, SortDirection } from '~/util/map_markers'
import { resolveMarkerIcon } from './marker_icons'

interface MarkerPanelProps {
  markers: MapMarker[]
  onDelete: (id: number) => void
  onFlyTo: (longitude: number, latitude: number) => void
  onSelect: (id: number | null) => void
  onToggleVisibility: (id: number, visible: boolean) => void
  selectedMarkerId: number | null
}

/**
 * Saved Locations: every pin, with search, sorting, show/hide and delete
 * (upstream a01aa5dc, 092762f5, c2e7bdbf).
 *
 * The row controls stay visible rather than appearing on hover, as upstream's
 * delete button does: a phone or tablet has no hover, so a touch user could
 * never reach it.
 */
export default function MarkerPanel({
  markers,
  onDelete,
  onFlyTo,
  onSelect,
  onToggleVisibility,
  selectedMarkerId,
}: MarkerPanelProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // The pin whose delete is armed. Deleting a place is not undoable and the
  // names are short and similar, so the trash icon arms rather than deletes.
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<MarkerSortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const filteredAndSortedMarkers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matching = query
      ? markers.filter((marker) => marker.name.toLowerCase().includes(query))
      : markers
    return sortMarkers(matching, sortField, sortDirection)
  }, [markers, searchQuery, sortField, sortDirection])

  const allFilteredMarkersVisible =
    filteredAndSortedMarkers.length > 0 &&
    filteredAndSortedMarkers.every((marker) => marker.visible)

  const setAllMarkerVisibility = (visible: boolean) => {
    filteredAndSortedMarkers.forEach((marker) => {
      if (marker.visible !== visible) {
        onToggleVisibility(marker.id, visible)
      }
    })
  }

  useEffect(() => {
    if (pendingDeleteId === null) return

    const stillListed = markers.some((marker) => marker.id === pendingDeleteId)
    if (!stillListed) setPendingDeleteId(null)
  }, [markers, pendingDeleteId])

  useEffect(() => {
    if (pendingDeleteId === null) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDeleteId(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingDeleteId])

  const renderMarkerRow = (marker: MapMarker) => {
    const MarkerIcon = resolveMarkerIcon(marker.icon)
    const confirmingDelete = pendingDeleteId === marker.id

    return (
      <li
        key={marker.id}
        className={`flex items-center gap-2 border-b border-border-subtle px-3 py-2 transition-colors last:border-b-0 ${
          marker.id === selectedMarkerId ? 'bg-desert-green/10' : 'hover:bg-surface-secondary'
        } ${marker.visible ? '' : 'opacity-60'}`}
      >
        <MarkerIcon
          size={16}
          className="shrink-0"
          style={{ color: resolvePinColor(marker.color, marker.customColor) }}
        />

        <button
          type="button"
          onClick={() => {
            onSelect(marker.id)
            onFlyTo(marker.longitude, marker.latitude)
          }}
          className="min-w-0 flex-1 text-left"
          title={marker.name}
        >
          <p className="truncate text-sm font-medium text-text-primary">{marker.name}</p>
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleVisibility(marker.id, !marker.visible)
          }}
          className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary"
          title={marker.visible ? 'Hide pin' : 'Show pin'}
          aria-label={marker.visible ? `Hide ${marker.name}` : `Show ${marker.name}`}
        >
          {marker.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        </button>

        {confirmingDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onDelete(marker.id)
                setPendingDeleteId(null)
              }}
              className="rounded bg-desert-red px-1.5 py-0.5 text-[11px] font-medium text-white transition-colors hover:brightness-110"
            >
              Delete
            </button>

            <button
              type="button"
              onClick={() => setPendingDeleteId(null)}
              className="rounded border border-border-default px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-secondary"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              // Show the user what they are about to lose before asking. A pin
              // is a place, and its name alone ("Well", "Cache") is not enough
              // to tell two apart -- so fly to it and select it, then confirm.
              setPendingDeleteId(marker.id)
              onSelect(marker.id)
              onFlyTo(marker.longitude, marker.latitude)
            }}
            className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-secondary hover:text-desert-red"
            title="Delete pin"
            aria-label={`Delete ${marker.name}`}
          >
            <IconTrash size={14} />
          </button>
        )}
      </li>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute left-4 top-[72px] z-40 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-primary/95 px-3 py-2 shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-secondary"
        title="Show saved locations"
      >
        <IconMapPin size={18} className="text-desert-orange" />
        <span className="text-sm font-medium text-text-primary">Pins</span>

        {markers.length > 0 && (
          <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-desert-orange px-1 text-[11px] font-bold text-white">
            {markers.length}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="absolute left-4 top-[72px] z-40 w-72 rounded-lg border border-border-subtle bg-surface-primary/95 shadow-lg backdrop-blur-sm">
      {/* The whole title bar closes the panel, mirroring the "Pins" button that
          opens it -- clicking the title to open but having to find the X to
          close is the kind of asymmetry that makes a panel feel fiddly. The X
          stays as the visible affordance. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(false)
          }
        }}
        title="Close panel"
        className="flex cursor-pointer items-center justify-between border-b border-border-subtle px-3 py-2.5 transition-colors hover:bg-surface-secondary"
      >
        <div className="flex items-center gap-2">
          <IconMapPin size={18} className="text-desert-orange" />

          <span className="text-sm font-semibold text-text-primary">Saved Locations</span>

          {markers.length > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-desert-orange px-1 text-[11px] font-bold text-white">
              {markers.length}
            </span>
          )}
        </div>

        <span aria-hidden="true" className="rounded p-0.5 text-text-muted transition-colors">
          <IconX size={16} />
        </span>
      </div>

      {markers.length > 0 && (
        <div className="space-y-2 border-b border-border-subtle px-3 py-2">
          <input
            type="search"
            placeholder="Search pins..."
            aria-label="Search pins"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full rounded border border-border-default bg-surface-primary px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-desert-green focus:outline-none"
          />

          <div className="flex gap-2">
            <select
              value={sortField}
              aria-label="Sort pins by"
              onChange={(e) => setSortField(e.target.value as MarkerSortField)}
              className="flex-1 rounded border border-border-default bg-surface-primary px-2 py-1 text-xs text-text-primary focus:border-desert-green focus:outline-none"
            >
              <option value="name">Sort by name</option>
              <option value="color">Sort by hue</option>
              <option value="icon">Sort by icon</option>
              <option value="visibility">Sort by visibility</option>
            </select>

            <button
              type="button"
              onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              className="rounded border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
            >
              {sortDirectionLabel(sortField, sortDirection)}
            </button>
          </div>

          {/* Hide all lived inside the tree view before it was removed; it is the
              one bulk control worth keeping, so it moved up here where it applies
              to whatever the list currently shows. */}
          {filteredAndSortedMarkers.length > 0 && (
            <StyledButton
              size="sm"
              variant="primary"
              fullWidth
              onClick={() => setAllMarkerVisibility(!allFilteredMarkersVisible)}
            >
              {allFilteredMarkersVisible ? 'Hide all' : 'Show all'}
            </StyledButton>
          )}
        </div>
      )}

      <div className="max-h-[calc(100vh-244px)] overflow-y-auto">
        {markers.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <IconMapPinFilled size={24} className="mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-muted">Click anywhere on the map to drop a pin</p>
          </div>
        ) : filteredAndSortedMarkers.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm text-text-muted">No pins match your search.</p>
          </div>
        ) : (
          <ul>{filteredAndSortedMarkers.map(renderMarkerRow)}</ul>
        )}
      </div>
    </div>
  )
}
