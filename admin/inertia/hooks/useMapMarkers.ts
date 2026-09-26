// eslint-disable-next-line @unicorn/filename-case
import { useCallback, useEffect, useState } from 'react'

import api from '~/lib/api'
import { PIN_COLORS } from '~/util/map_markers'
import type { PinColorId } from '~/util/map_markers'
import type { MapMarkerResponse } from '../../types/maps'

// The palette lives in util/map_markers.ts so the standalone checks can load it.
export { PIN_COLORS }
export type { PinColorId }

export interface MapMarker {
  id: number
  name: string
  longitude: number
  latitude: number
  color: PinColorId
  customColor?: string | null
  /** A name from components/maps/marker_icons.ts, e.g. "tabler:IconDroplet". */
  icon?: string | null
  iconColor?: string | null
  visible: boolean
  notes?: string | null
  createdAt: string
  updatedAt?: string
}

type CreateMapMarkerValues = {
  name: string
  longitude: number
  latitude: number
  color?: PinColorId
  customColor?: string | null
  icon?: string | null
  iconColor?: string | null
  visible?: boolean
  notes?: string | null
}

type UpdateMapMarkerValues = {
  name?: string
  color?: PinColorId
  customColor?: string | null
  icon?: string | null
  iconColor?: string | null
  visible?: boolean
  notes?: string | null
}

const mapMarkerResponse = (marker: MapMarkerResponse): MapMarker => ({
  id: marker.id,
  name: marker.name,
  longitude: marker.longitude,
  latitude: marker.latitude,
  color: marker.color as PinColorId,
  customColor: marker.custom_color ?? null,
  icon: marker.icon ?? null,
  iconColor: marker.icon_color ?? null,
  visible: marker.visible ?? true,
  notes: marker.notes ?? null,
  createdAt: marker.created_at,
  updatedAt: marker.updated_at,
})

/**
 * The user's saved places, loaded once and kept in step with the server
 * (upstream a01aa5dc, 102a00ba).
 *
 * addMarker and updateMarker return the saved marker, or null when the save
 * failed. api.ts has already shown the error by then; callers use the null to
 * keep a popup open instead of discarding what was typed. deleteMarker returns
 * whether the pin is gone.
 */
export function useMapMarkers() {
  const [markers, setMarkers] = useState<MapMarker[]>([])
  const [loaded, setLoaded] = useState(false)

  // Load markers from API on mount
  useEffect(() => {
    api.listMapMarkers().then((data) => {
      if (data) {
        setMarkers(data.map(mapMarkerResponse))
      }

      setLoaded(true)
    })
  }, [])

  const addMarker = useCallback(async (values: CreateMapMarkerValues) => {
    const result = await api.createMapMarker({
      name: values.name,
      longitude: values.longitude,
      latitude: values.latitude,
      color: values.color ?? 'orange',
      custom_color: values.customColor ?? null,
      icon: values.icon ?? null,
      icon_color: values.iconColor ?? null,
      visible: values.visible ?? true,
      notes: values.notes ?? null,
    })

    if (result) {
      const marker = mapMarkerResponse(result)
      setMarkers((prev) => [...prev, marker])
      return marker
    }

    return null
  }, [])

  const updateMarker = useCallback(async (id: number, updates: UpdateMapMarkerValues) => {
    const result = await api.updateMapMarker(id, {
      name: updates.name,
      color: updates.color,
      custom_color: updates.customColor,
      icon: updates.icon,
      icon_color: updates.iconColor,
      visible: updates.visible,
      notes: updates.notes,
    })

    if (result) {
      const marker = mapMarkerResponse(result)

      setMarkers((prev) =>
        prev.map((existingMarker) => (existingMarker.id === id ? marker : existingMarker))
      )

      return marker
    }

    return null
  }, [])

  // Only drop the pin once the server has. Upstream removes it from the list either
  // way, so a failed delete looked done and the pin came back on the next visit.
  const deleteMarker = useCallback(async (id: number) => {
    const deleted = await api.deleteMapMarker(id)
    if (!deleted) return false
    setMarkers((prev) => prev.filter((marker) => marker.id !== id))
    return true
  }, [])

  return { markers, loaded, addMarker, updateMarker, deleteMarker }
}
