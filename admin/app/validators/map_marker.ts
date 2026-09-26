import vine from '@vinejs/vine'

/**
 * Map markers: the places a user saves on the offline map.
 *
 * This module imports nothing relative, so the standalone checks can load it. The
 * limits are written out here and held to the form's own constants
 * (inertia/util/map_markers.ts) by tests/standalone/map_markers.standalone.ts.
 *
 * - Notes are capped at 500 characters (upstream f702ff51). The column is TEXT;
 *   the cap is about what a pin's popup can sensibly show.
 * - custom_color and icon_color must be "#rrggbb". Upstream only caps them at 7
 *   characters, but both are drawn straight into the pin's SVG and inline styles,
 *   and the color picker only ever produces that form.
 * - icon is a name from the curated set, e.g. "tabler:IconDroplet". A name the
 *   set does not have still renders, as the default pin, so it is only capped.
 *
 * Upstream compiles these inline in MapsController on every request.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// A function rather than a shared object so each validator gets its own schema nodes.
const markerFields = () => ({
  color: vine.string().trim().maxLength(20).optional(),
  custom_color: vine.string().trim().regex(HEX_COLOR).nullable().optional(),
  icon: vine.string().trim().maxLength(50).nullable().optional(),
  icon_color: vine.string().trim().regex(HEX_COLOR).nullable().optional(),
  visible: vine.boolean().optional(),
  notes: vine.string().trim().maxLength(500).nullable().optional(),
  marker_type: vine.string().trim().maxLength(20).optional(),
})

export const createMapMarkerValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    longitude: vine.number().min(-180).max(180),
    latitude: vine.number().min(-90).max(90),
    ...markerFields(),
  })
)

export const updateMapMarkerValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    longitude: vine.number().min(-180).max(180).optional(),
    latitude: vine.number().min(-90).max(90).optional(),
    ...markerFields(),
  })
)
