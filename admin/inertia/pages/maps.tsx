import { useRef, useState } from 'react'
import MapsLayout from '~/layouts/MapsLayout'
import { Head, Link } from '@inertiajs/react'
import MapComponent from '~/components/maps/MapComponent'
import type { MapCommand } from '~/components/maps/MapComponent'
import StyledButton from '~/components/StyledButton'
import { IconArrowLeft, IconCrosshair, IconMapPin, IconPlaneTilt } from '@tabler/icons-react'
import { FileEntry } from '../../types/files'
import Alert from '~/components/Alert'
import { parseCoordinateSearch } from '~/util/map_markers'

export default function Maps(props: {
  maps: { baseAssetsExist: boolean; regionFiles: FileEntry[] }
}) {
  // Suppress the live coordinate overlay while the cursor is over a UI overlay.
  const [isHoveringUI, setIsHoveringUI] = useState(false)
  const [showCoordinatesEnabled, setShowCoordinatesEnabled] = useState(true)

  // The coordinate box (upstream a01aa5dc): fly to a typed "lat, lng", or fly
  // there and start a pin.
  const [coordinateSearch, setCoordinateSearch] = useState('')
  const [coordinateError, setCoordinateError] = useState(false)
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null)
  const nextCommandId = useRef(0)

  const handleCoordinateAction = (action: MapCommand['action']) => {
    const coordinates = parseCoordinateSearch(coordinateSearch)
    // Upstream ignores input it cannot read; saying so beats a button that
    // silently does nothing.
    setCoordinateError(!coordinates)
    if (!coordinates) return

    nextCommandId.current += 1
    setMapCommand({ id: nextCommandId.current, ...coordinates, action })
  }

  const alertMessage = !props.maps.baseAssetsExist
    ? 'The base map assets have not been installed. Please download them first to enable map functionality.'
    : props.maps.regionFiles.length === 0
      ? 'No map regions have been downloaded yet. Please download some regions to enable map functionality.'
      : null

  return (
    <MapsLayout>
      <Head title="Maps" />
      <div className="relative w-full h-screen overflow-hidden">
        {/* Nav and alerts are overlayed */}
        <div
          className="absolute top-0 left-0 right-0 z-50 flex justify-between p-4 bg-surface-secondary backdrop-blur-sm shadow-sm"
          onMouseEnter={() => setIsHoveringUI(true)}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          <Link href="/home" className="flex items-center">
            <IconArrowLeft className="mr-2" size={24} />
            <p className="text-lg text-text-secondary">Back to Home</p>
          </Link>

          <div className="flex items-center gap-2 mr-4">
            {/* From tablet width up. Below that the bar has no room for them, and
                the live coordinate readout follows a mouse pointer anyway. */}
            <div className="hidden md:flex items-center gap-2">
              <input
                type="text"
                placeholder="lat, lng"
                aria-label="Latitude and longitude, for example 40.015, -105.27"
                title="Latitude and longitude, for example 40.015, -105.27"
                aria-invalid={coordinateError}
                value={coordinateSearch}
                onChange={(event) => {
                  setCoordinateSearch(event.target.value)
                  setCoordinateError(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleCoordinateAction('fly')
                }}
                className={`w-52 rounded border bg-surface-primary px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${
                  coordinateError
                    ? 'border-desert-red focus:border-desert-red'
                    : 'border-border-default focus:border-desert-green'
                }`}
              />

              <button
                type="button"
                onClick={() => handleCoordinateAction('fly')}
                className="rounded border border-border-default bg-surface-primary p-2 text-text-secondary hover:bg-surface-secondary"
                title="Fly to coordinates"
                aria-label="Fly to coordinates"
              >
                <IconPlaneTilt size={18} />
              </button>

              <button
                type="button"
                onClick={() => handleCoordinateAction('marker')}
                className="rounded border border-border-default bg-surface-primary p-2 text-text-secondary hover:bg-surface-secondary"
                title="Add a pin at these coordinates"
                aria-label="Add a pin at these coordinates"
              >
                <IconMapPin size={18} />
              </button>

              <button
                type="button"
                onClick={() => setShowCoordinatesEnabled((prev) => !prev)}
                aria-pressed={showCoordinatesEnabled}
                className={`rounded border border-border-default p-2 transition-colors ${
                  showCoordinatesEnabled
                    ? 'bg-desert-green text-white'
                    : 'bg-surface-primary text-text-secondary hover:bg-surface-secondary'
                }`}
                title={showCoordinatesEnabled ? 'Hide coordinates' : 'Show coordinates'}
                aria-label={showCoordinatesEnabled ? 'Hide coordinates' : 'Show coordinates'}
              >
                <IconCrosshair size={18} />
              </button>
            </div>

            <Link href="/settings/maps">
              <StyledButton variant="primary" icon="IconSettings">
                Manage Map Regions
              </StyledButton>
            </Link>
          </div>
        </div>
        {alertMessage && (
          <div
            className="absolute top-20 left-4 right-4 z-50"
            onMouseEnter={() => setIsHoveringUI(true)}
            onMouseLeave={() => setIsHoveringUI(false)}
          >
            <Alert
              title={alertMessage}
              type="warning"
              variant="solid"
              className="w-full"
              buttonProps={{
                variant: 'secondary',
                children: 'Go to Map Settings',
                icon: 'IconSettings',
                onClick: () => {
                  window.location.href = '/settings/maps'
                },
              }}
            />
          </div>
        )}
        <div className="absolute inset-0">
          <MapComponent
            mapCommand={mapCommand}
            isHoveringUI={isHoveringUI}
            showCoordinatesEnabled={showCoordinatesEnabled}
          />
        </div>
      </div>
    </MapsLayout>
  )
}
