import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Popup } from 'react-map-gl/maplibre'
import { IconIcons, IconPalette } from '@tabler/icons-react'

import StyledButton from '~/components/StyledButton'
import type { MapMarker } from '~/hooks/useMapMarkers'
import {
  MAX_MARKER_NAME_LENGTH,
  MAX_MARKER_NOTES_LENGTH,
  PIN_COLORS,
  resolvePinColor,
} from '~/util/map_markers'
import type { PinColorId } from '~/util/map_markers'
import IconSelectorPopover from './IconSelectorPopover'

// The pin popups keep their own compact fields, as the pin popup before them did:
// app.css themes inputs and textareas inside a map popup for dark mode.
const inputClass =
  'block w-full rounded border border-border-default bg-transparent px-2 py-1 text-sm leading-normal text-text-primary placeholder:text-text-muted focus:border-desert-green focus:outline-none'

type MapMarkerFormPopupProps = {
  longitude: number
  latitude: number
  /** The marker being edited; absent when placing a new one. */
  initialMarker?: MapMarker
  onSave: (values: {
    id?: number
    name: string
    notes: string
    color: PinColorId
    customColor: string | null
    icon: string | null
  }) => Promise<void> | void
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
  onMouseEnter?: () => void
}

/**
 * Name, notes, color and icon for a pin, when placing one or editing it
 * (upstream a01aa5dc).
 */
export default function MapMarkerFormPopup({
  longitude,
  latitude,
  initialMarker,
  onSave,
  onCancel,
  onDirtyChange,
  onMouseEnter,
}: MapMarkerFormPopupProps) {
  const [name, setName] = useState(initialMarker?.name ?? '')
  const [notes, setNotes] = useState(initialMarker?.notes ?? '')
  const [color, setColor] = useState<PinColorId>(initialMarker?.color ?? 'orange')
  const [customColor, setCustomColor] = useState<string | null>(initialMarker?.customColor ?? null)
  const [icon, setIcon] = useState<string | null>(initialMarker?.icon ?? null)
  const [showIconSelector, setShowIconSelector] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const colorInputRef = useRef<HTMLInputElement | null>(null)

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [resizeTextarea])

  useLayoutEffect(() => {
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }, [])

  const isDirty =
    name !== (initialMarker?.name ?? '') ||
    notes !== (initialMarker?.notes ?? '') ||
    color !== (initialMarker?.color ?? 'orange') ||
    customColor !== (initialMarker?.customColor ?? null) ||
    icon !== (initialMarker?.icon ?? null)

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // A pin saved before notes were capped can carry more than the server now
  // accepts. The field still shows all of it (maxLength stops typing, not an
  // existing value), and Save waits until it is short enough rather than failing
  // on the server with a generic error.
  const notesTooLong = notes.trim().length > MAX_MARKER_NOTES_LENGTH
  const canSave = name.trim().length > 0 && !notesTooLong && !isSaving

  const handleSave = async () => {
    if (!canSave) return

    try {
      setIsSaving(true)

      await onSave({
        id: initialMarker?.id,
        name: name.trim(),
        notes: notes.trim(),
        color,
        customColor,
        icon,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Popup
      longitude={longitude}
      latitude={latitude}
      anchor="bottom"
      offset={[0, -36] as [number, number]}
      onClose={onCancel}
      closeOnClick={false}
      closeButton={false}
      // Above the map's own controls (z-index 2), which otherwise sit over the
      // popup and its icon grid near a corner: MapLibre's attribution covered the
      // grid's Close button at the bottom right. Still under the Pins panel (z-40)
      // and the top bar (z-50).
      className="z-10"
    >
      <div
        className="p-1"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
      >
        <input
          ref={nameInputRef}
          autoFocus
          type="text"
          placeholder="Name this location"
          value={name}
          maxLength={MAX_MARKER_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') onCancel()
          }}
          className={inputClass}
        />

        <textarea
          ref={textareaRef}
          placeholder="Add notes (optional)"
          value={notes}
          rows={2}
          maxLength={MAX_MARKER_NOTES_LENGTH}
          onChange={(e) => {
            setNotes(e.target.value)
            requestAnimationFrame(resizeTextarea)
          }}
          className={`mt-1 min-h-[64px] max-h-[240px] resize-none overflow-y-auto themed-scrollbar ${inputClass}`}
        />

        <div className={`mt-1 text-[11px] ${notesTooLong ? 'text-desert-red' : 'text-text-muted'}`}>
          {notes.trim().length}/{MAX_MARKER_NOTES_LENGTH}
          {notesTooLong && ' · shorten the notes to save'}
        </div>

        <div className="mt-1.5 flex items-center gap-1">
          {PIN_COLORS.map((pinColor) => (
            <button
              key={pinColor.id}
              type="button"
              onClick={() => {
                setColor(pinColor.id)
                setCustomColor(null)
              }}
              title={pinColor.label}
              aria-label={pinColor.label}
              aria-pressed={!customColor && color === pinColor.id}
              className="rounded-full p-0.5 transition-transform"
              style={{
                outline:
                  !customColor && color === pinColor.id
                    ? `2px solid ${pinColor.hex}`
                    : '2px solid transparent',
                outlineOffset: '1px',
              }}
            >
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: pinColor.hex }} />
            </button>
          ))}

          <button
            type="button"
            title="Choose a custom color"
            aria-label="Choose a custom color"
            aria-pressed={Boolean(customColor)}
            onClick={() => colorInputRef.current?.click()}
            className="rounded-full p-0.5 transition-transform"
            style={{
              outline: customColor ? `2px solid ${customColor}` : '2px solid transparent',
              outlineOffset: '1px',
            }}
          >
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full border border-border-default"
              style={{ backgroundColor: customColor ?? 'var(--color-desert-green)' }}
            >
              <IconPalette size={16} fill="currentColor" stroke={1.5} className="text-white" />
            </span>
          </button>

          <div className="relative">
            <button
              type="button"
              title="Choose an icon"
              aria-label="Choose an icon"
              aria-expanded={showIconSelector}
              onClick={() => setShowIconSelector((prev) => !prev)}
              className="rounded-full p-0.5 transition-transform"
              style={{
                outline: icon ? '2px solid var(--color-desert-green)' : '2px solid transparent',
                outlineOffset: '1px',
              }}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border-default bg-desert-green text-white">
                <IconIcons size={16} fill="currentColor" stroke={1.5} />
              </span>
            </button>

            {showIconSelector && (
              <IconSelectorPopover
                selectedIcon={icon}
                onSelect={setIcon}
                onClose={() => setShowIconSelector(false)}
              />
            )}
          </div>

          <input
            ref={colorInputRef}
            type="color"
            value={customColor ?? resolvePinColor(color)}
            onChange={(e) => setCustomColor(e.target.value)}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>

        <div className="mt-1.5 flex justify-end gap-1.5">
          <StyledButton size="sm" variant="outline" onClick={onCancel} disabled={isSaving}>
            Cancel
          </StyledButton>

          <StyledButton
            size="sm"
            variant="primary"
            onClick={handleSave}
            disabled={!canSave}
            loading={isSaving}
          >
            Save
          </StyledButton>
        </div>
      </div>
    </Popup>
  )
}
