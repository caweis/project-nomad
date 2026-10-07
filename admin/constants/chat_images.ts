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
export const CHAT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const
