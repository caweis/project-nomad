import vine from '@vinejs/vine'
import { LINK_TILE_COLOR_IDS } from '../../constants/link_tile_colors.js'

/**
 * Home-screen link tiles: a shortcut to something the user already runs, with no
 * container behind it (upstream 2c73139b).
 *
 * One `url` field rather than separate host/port/path, because people paste URLs
 * and it gets https and sub-paths for free. The URL is normalized and restricted
 * to http(s) by checkCustomUrl (util/custom_url.ts) in the controller, which is
 * what keeps javascript:/data: out of an href; the length cap here only bounds
 * what is sent, and the stored value is bounded after normalization.
 *
 * Upstream keeps these in validators/system.ts. They live apart here because that
 * module has to stay free of relative imports to load under the standalone
 * harness, and the color enum needs one.
 */
export const createLinkTileValidator = vine.compile(
  vine.object({
    friendly_name: vine.string().trim().minLength(1).maxLength(60),
    url: vine.string().trim().minLength(1).maxLength(2048),
    description: vine.string().trim().maxLength(200).nullable().optional(),
    icon: vine.string().trim().maxLength(60).nullable().optional(),
    display_order: vine.number().min(0).max(999).optional(),
    link_color: vine.enum(LINK_TILE_COLOR_IDS).optional(),
  })
)

/** Reconfigure an existing link tile. Identified by service_name, which is immutable. */
export const updateLinkTileValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
    friendly_name: vine.string().trim().minLength(1).maxLength(60),
    url: vine.string().trim().minLength(1).maxLength(2048),
    description: vine.string().trim().maxLength(200).nullable().optional(),
    icon: vine.string().trim().maxLength(60).nullable().optional(),
    display_order: vine.number().min(0).max(999).optional(),
    link_color: vine.enum(LINK_TILE_COLOR_IDS).optional(),
  })
)

export const deleteLinkTileValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
  })
)
