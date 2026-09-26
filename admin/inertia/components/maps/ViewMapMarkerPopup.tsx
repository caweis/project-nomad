import { Popup } from 'react-map-gl/maplibre'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import StyledButton from '~/components/StyledButton'
import type { MapMarker } from '~/hooks/useMapMarkers'

type ViewMapMarkerPopupProps = {
  marker: MapMarker
  onClose: () => void
  onEdit: () => void
  onMouseEnter?: () => void
}

/**
 * A saved pin's name and notes, with Edit (upstream a01aa5dc). Notes render as
 * Markdown, so a link in them can be followed.
 */
export default function ViewMapMarkerPopup({
  marker,
  onClose,
  onEdit,
  onMouseEnter,
}: ViewMapMarkerPopupProps) {
  return (
    <Popup
      longitude={marker.longitude}
      latitude={marker.latitude}
      anchor="bottom"
      offset={[0, -36] as [number, number]}
      onClose={onClose}
      closeOnClick={false}
      closeButton={false}
      // Above the map's controls, as the form popup is (see MapMarkerFormPopup).
      className="z-10"
    >
      <div
        className="max-w-[260px]"
        onMouseEnter={onMouseEnter}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="break-words text-sm font-medium">{marker.name}</div>

        {marker.notes && (
          // break-words rather than upstream's break-all, which splits ordinary
          // words at the edge; a long URL still wraps. pre-wrap keeps the line
          // breaks typed into the notes field, which Markdown would otherwise join.
          <div className="mt-1 max-w-[240px] whitespace-pre-wrap break-words text-xs text-text-secondary">
            {/* react-markdown is intentionally used without rehypeRaw.
                Do not enable raw HTML rendering unless notes are sanitized first. */}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-desert-green underline hover:text-desert-green/80"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {marker.notes}
            </ReactMarkdown>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-1.5">
          <StyledButton size="sm" variant="outline" onClick={onClose}>
            Close
          </StyledButton>
          <StyledButton size="sm" variant="primary" onClick={onEdit}>
            Edit
          </StyledButton>
        </div>
      </div>
    </Popup>
  )
}
