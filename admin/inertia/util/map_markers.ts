/**
 * Map marker helpers: colors, sorting, and reading coordinates typed by a person
 * or passed in a URL.
 *
 * Pure and dependency-free on purpose: no React, no .tsx and no relative imports,
 * so the standalone gate (tests/standalone/map_markers.standalone.ts) can
 * strip-run it, as it does home_decks.ts. Upstream keeps most of this inline in
 * its map components (a01aa5dc, 102a00ba).
 */

export const PIN_COLORS = [
  { id: 'orange', label: 'Orange', hex: '#a84a12' },
  { id: 'red', label: 'Red', hex: '#994444' },
  { id: 'green', label: 'Green', hex: '#424420' },
  { id: 'blue', label: 'Blue', hex: '#2563eb' },
  { id: 'purple', label: 'Purple', hex: '#7c3aed' },
  { id: 'yellow', label: 'Yellow', hex: '#ca8a04' },
] as const

export type PinColorId = (typeof PIN_COLORS)[number]['id']

/** Longest note the server accepts (validators/map_marker.ts, upstream f702ff51). */
export const MAX_MARKER_NOTES_LENGTH = 500

/** Longest name the server accepts; map_markers.name is a VARCHAR(255). */
export const MAX_MARKER_NAME_LENGTH = 255

/** Zoom used when a URL gives a place but no zoom. */
export const DEFAULT_LOCATION_ZOOM = 12

// ── Coordinates ──

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

/**
 * Read "lat,lng" as typed into the map's search box, e.g. "40.015, -105.27".
 *
 * A comma or a space may separate the two numbers, which covers what map sites
 * put on the clipboard. Both must be present: Number('') is 0, so an input such
 * as "40.015," would otherwise quietly mean longitude 0, the same fault that
 * sent a plain visit to /maps to 0,0 (upstream 102a00ba).
 */
export function parseCoordinateSearch(text: string): { lat: number; lng: number } | null {
  const parts = text
    .trim()
    .split(/\s*,\s*|\s+/)
    .filter((part) => part.length > 0)
  if (parts.length !== 2) return null
  const lat = Number(parts[0])
  const lng = Number(parts[1])
  return isValidCoordinate(lat, lng) ? { lat, lng } : null
}

/**
 * Read a location from a /maps query string: ?lat=&lng=&zoom=, with `long`
 * accepted for `lng`.
 *
 * `canonicalSearch` is the query string to put back in the address bar when
 * `long` was used, so a copied link reads `lng`; null when nothing needs changing.
 */
export function parseMapLocationParams(search: string): {
  lat: number
  lng: number
  zoom: number
  canonicalSearch: string | null
} | null {
  const params = new URLSearchParams(search)
  const latParam = params.get('lat')?.trim()
  const lngParam = params.get('lng')?.trim()
  const longParam = params.get('long')?.trim()
  const rawLng = lngParam || longParam

  // Both coordinates must actually be present. Coercing a missing or blank one
  // gives 0, which passes every bounds check, flies a plain visit to /maps to 0,0,
  // and then saves Null Island over the restored view (upstream 102a00ba).
  if (!latParam || !rawLng) return null

  const lat = Number(latParam)
  const lng = Number(rawLng)
  if (!isValidCoordinate(lat, lng)) return null

  const zoomParam = params.get('zoom')?.trim()
  const zoom = zoomParam ? Number(zoomParam) : DEFAULT_LOCATION_ZOOM

  let canonicalSearch: string | null = null
  if (!lngParam && longParam) {
    params.set('lng', longParam)
    params.delete('long')
    canonicalSearch = params.toString()
  }

  return {
    lat,
    lng,
    zoom: Number.isFinite(zoom) ? zoom : DEFAULT_LOCATION_ZOOM,
    canonicalSearch,
  }
}

// ── Colors ──

/** A pin's fill: its custom color, else its preset's, else the default orange. */
export function resolvePinColor(color?: string | null, customColor?: string | null): string {
  if (customColor) return customColor
  if (!color) return PIN_COLORS[0].hex
  return PIN_COLORS.find((pinColor) => pinColor.id === color)?.hex ?? color
}

const DARK_ICON = '#111827'
const LIGHT_ICON = '#ffffff'

/** WCAG relative luminance of a "#rrggbb" color, or null for anything else. */
export function relativeLuminance(color: string): number | null {
  const hex = color.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two "#rrggbb" colors, or null if either is not one. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The icon color for a pin: white or near-black, whichever contrasts more with
 * the pin, so the glyph stays legible on a yellow pin as on a green one.
 *
 * Upstream compares an uncorrected brightness against a fixed 0.55, which picks
 * the weaker of the two for mid-tones such as a grey. Measuring both contrasts
 * the WCAG way cannot. Anything that is not "#rrggbb" gets white.
 */
export function contrastingIconColor(backgroundColor: string): string {
  const onLight = contrastRatio(backgroundColor, LIGHT_ICON)
  const onDark = contrastRatio(backgroundColor, DARK_ICON)
  if (onLight === null || onDark === null) return LIGHT_ICON
  return onDark > onLight ? DARK_ICON : LIGHT_ICON
}

/**
 * Where a color sorts when the list is ordered by hue: greys first, then colors
 * around the wheel from red, then anything unreadable.
 */
export function colorSortValue(
  color: string,
  customColor?: string | null
): { bucket: number; hue: number; lightness: number } {
  const hex = resolvePinColor(color, customColor).replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { bucket: 2, hue: 0, lightness: 0 }

  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) return { bucket: 0, hue: 0, lightness }

  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4

  return { bucket: 1, hue: Math.round(hue * 60 + 360) % 360, lightness }
}

// ── Sorting the marker list ──

export type MarkerSortField = 'name' | 'color' | 'icon' | 'visibility'
export type SortDirection = 'asc' | 'desc'

export interface SortableMarker {
  name: string
  color: string
  customColor?: string | null
  icon?: string | null
  visible: boolean
}

const compareNames = (a: SortableMarker, b: SortableMarker) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

function compareBy(field: MarkerSortField, a: SortableMarker, b: SortableMarker): number {
  switch (field) {
    case 'name':
      return compareNames(a, b)
    case 'visibility':
      return Number(a.visible) - Number(b.visible)
    case 'icon':
      return (
        (a.icon ? 1 : 0) - (b.icon ? 1 : 0) ||
        (a.icon ?? '').localeCompare(b.icon ?? '', undefined, { sensitivity: 'base' })
      )
    case 'color': {
      const x = colorSortValue(a.color, a.customColor)
      const y = colorSortValue(b.color, b.customColor)
      return x.bucket - y.bucket || x.hue - y.hue || x.lightness - y.lightness
    }
  }
}

/**
 * The marker list in the chosen order. Ties go alphabetically by name in either
 * direction, so a group (every hidden pin, every red one) reads as a sorted list
 * rather than in the order the pins happened to be made.
 */
export function sortMarkers<T extends SortableMarker>(
  markers: readonly T[],
  field: MarkerSortField,
  direction: SortDirection
): T[] {
  return [...markers].sort((a, b) => {
    const primary = compareBy(field, a, b)
    if (primary !== 0) return direction === 'asc' ? primary : -primary
    return field === 'name' ? 0 : compareNames(a, b)
  })
}

/** The label on the sort-direction button for each field and direction. */
export function sortDirectionLabel(field: MarkerSortField, direction: SortDirection): string {
  switch (field) {
    case 'color':
      return direction === 'asc' ? 'Hue ↑' : 'Hue ↓'
    case 'visibility':
      return direction === 'asc' ? 'Hidden first' : 'Visible first'
    default:
      return direction === 'asc' ? 'A → Z' : 'Z → A'
  }
}
