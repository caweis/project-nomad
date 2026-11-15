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

export const addCustomLibraryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    base_url: vine.string().trim().url({ require_tld: false }).maxLength(2048),
  })
)

export const customLibraryIdValidator = vine.compile(
  vine.object({
    params: vine.object({ id: vine.number().min(1) }),
  })
)

export const browseCustomLibraryValidator = vine.compile(
  vine.object({
    params: vine.object({ id: vine.number().min(1) }),
    path: vine.string().maxLength(1024).optional(),
  })
)
