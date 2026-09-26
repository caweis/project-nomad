import { IconCircleFilled } from '@tabler/icons-react'

import { contrastingIconColor, resolvePinColor } from '~/util/map_markers'
import type { PinColorId } from '~/util/map_markers'
import { resolveMarkerIcon } from './marker_icons'

interface MarkerPinProps {
  color?: PinColorId | string | null
  customColor?: string | null
  icon?: string | null
  iconColor?: string | null
  visible?: boolean
  active?: boolean
}

/**
 * A saved place on the map: a pin drawn as SVG so its point sits exactly on the
 * coordinate (the Marker anchors at its bottom), with the marker's icon inside
 * (upstream a01aa5dc).
 */
export default function MarkerPin({
  color = 'orange',
  customColor,
  icon,
  iconColor,
  visible = true,
  active = false,
}: MarkerPinProps) {
  if (!visible) return null

  const resolvedColor = resolvePinColor(color, customColor)
  const resolvedIconColor = iconColor ?? contrastingIconColor(resolvedColor)
  // A pin's inner glyph defaults to a filled circle, not a map pin.
  const Icon = resolveMarkerIcon(icon, IconCircleFilled)

  const width = active ? 42 : 36
  const height = active ? 52 : 46
  const iconSize = active ? 18 : 16

  return (
    <div
      className="relative cursor-pointer"
      style={{
        width,
        height,
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox="0 0 36 46"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M18 45 C18 45 4 27.5 4 16.5 C4 7.4 10.3 1 18 1 C25.7 1 32 7.4 32 16.5 C32 27.5 18 45 18 45 Z"
          fill={resolvedColor}
          stroke="rgba(0,0,0,0.25)"
          strokeWidth="1.5"
        />

        <circle cx="18" cy="16.5" r="10.5" fill="rgba(255,255,255,0.18)" />
      </svg>

      <div
        className="pointer-events-none absolute flex items-center justify-center"
        style={{
          left: '50%',
          top: active ? 17 : 15,
          transform: 'translate(-50%, -50%)',
          width: iconSize,
          height: iconSize,
        }}
      >
        <Icon size={iconSize} color={resolvedIconColor} />
      </div>
    </div>
  )
}
