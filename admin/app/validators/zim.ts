import vine from '@vinejs/vine'
import { CATALOG_LANGUAGE_PATTERN } from '../utils/catalog_languages.js'

export const listRemoteZimValidator = vine.compile(
  vine.object({
    start: vine.number().min(0).optional(),
    count: vine.number().min(1).max(100).optional(),
    query: vine.string().optional(),
    // An ISO-639 code (`eng`, `fra`, `zho`) or the literal `all`. Held to a
    // short alphabetic token so it can never carry anything else into the
    // upstream catalog's query string (upstream dde8aa55).
    language: vine.string().trim().regex(CATALOG_LANGUAGE_PATTERN).optional(),
  })
)
