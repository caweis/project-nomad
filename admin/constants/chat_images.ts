/**
 * Limits for images attached to a chat message (upstream edbfe1ad).
 *
 * One file, read by both the browser and the server, so the page never offers
 * what the server will refuse. Pure and import-free.
 */

export type ChatImageLimits = {
  /** Most images one message may carry. */
  maxImages: number
  /** Largest file a person may attach, before it is shrunk. */
  maxBytes: number
  /** Refuse to decode anything with more pixels than this (decompression bombs). */
  maxPixels: number
  /** Widest or tallest side after the server shrinks an image, in pixels. */
  maxDimension: number
  /** Largest an image may be after it has been shrunk and re-encoded. */
  maxNormalizedBytes: number
}

export const CHAT_IMAGE_LIMITS: ChatImageLimits = {
  maxImages: 4,
  maxBytes: 8 * 1024 * 1024,
  maxPixels: 40_000_000,
  maxDimension: 2048,
  maxNormalizedBytes: 4 * 1024 * 1024,
}

/** What the file picker and the server both accept. Everything is re-encoded as JPEG. */
export const CHAT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * How the server's upload parser is asked to read the `images` field: by size
 * only. The type is deliberately not checked by file name. The parser's
 * extension check is case-sensitive, and with an extension list here it refused
 * IMG_0001.JPG, the way cameras name their files, and .jfif, although the page
 * offered both. What decides is the decoded image (normalizeChatImages), which
 * refuses anything that is not JPEG, PNG or WebP whatever the file is called.
 */
export const CHAT_IMAGE_UPLOAD_OPTIONS = { size: CHAT_IMAGE_LIMITS.maxBytes } as const
