import sharp from 'sharp'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import type { ChatImageLimits } from '../../constants/chat_images.js'

/**
 * Images attached to a chat message (upstream edbfe1ad, adapted).
 *
 * Whatever the person attaches is decoded, turned upright, shrunk, flattened
 * onto white and re-encoded as a JPEG before a model sees it. That does four
 * jobs at once: it bounds what a vision model is asked to digest, it keeps an
 * 8 MB phone photo from filling the context window, it strips metadata the
 * person did not mean to send (location, camera serial), and it gives the oMLX
 * proxy the one format it assumes when an image arrives without a type.
 *
 * Only the sharp import is a dependency, and the limits are passed in rather
 * than imported, so the standalone checks can load this and exercise real image
 * decoding with limits small enough to hit every boundary.
 */

/** A refusal the person can act on. `status` is the HTTP status to answer with. */
export class ChatImageError extends Error {
  readonly status: 413 | 415 | 422

  // An explicit field rather than a constructor parameter property: Node's
  // strip-only TypeScript mode, which the standalone checks run under, rejects
  // the shorthand.
  constructor(message: string, status: 413 | 415 | 422) {
    super(message)
    this.name = 'ChatImageError'
    this.status = status
  }
}

/** An image ready to send: its original name, and the JPEG as base64 (no data: prefix). */
export type NormalizedChatImage = {
  name: string
  base64: string
}

const SUPPORTED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp'])

const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`

export async function normalizeChatImages(
  files: MultipartFile[],
  limits: ChatImageLimits
): Promise<NormalizedChatImage[]> {
  if (files.length > limits.maxImages) {
    throw new ChatImageError(`Attach no more than ${limits.maxImages} images.`, 422)
  }

  const normalized: NormalizedChatImage[] = []
  for (const file of files) {
    normalized.push(await normalizeChatImage(file, limits))
  }
  return normalized
}

async function normalizeChatImage(
  file: MultipartFile,
  limits: ChatImageLimits
): Promise<NormalizedChatImage> {
  if (!file.tmpPath) {
    throw new ChatImageError(`Could not process "${file.clientName}".`, 422)
  }
  if (file.size > limits.maxBytes) {
    throw new ChatImageError(
      `"${file.clientName}" exceeds the ${megabytes(limits.maxBytes)} per-image limit.`,
      413
    )
  }
  if (!file.isValid) {
    // The upload parser already knows why. Say that, not a generic refusal.
    const reason = file.errors?.[0]?.type
    if (reason === 'size') {
      throw new ChatImageError(
        `"${file.clientName}" exceeds the ${megabytes(limits.maxBytes)} per-image limit.`,
        413
      )
    }
    if (reason === 'extname') {
      throw new ChatImageError(
        `"${file.clientName}" is not supported. Use JPEG, PNG, or WebP.`,
        415
      )
    }
    throw new ChatImageError(`"${file.clientName}" is not a valid image upload.`, 422)
  }

  try {
    const pipeline = sharp(file.tmpPath, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: limits.maxPixels,
    })
    const metadata = await pipeline.metadata()

    if (!metadata.format || !SUPPORTED_IMAGE_FORMATS.has(metadata.format)) {
      throw new ChatImageError(
        `"${file.clientName}" is not supported. Use JPEG, PNG, or WebP.`,
        415
      )
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new ChatImageError(
        `"${file.clientName}" is animated, and animated images are not supported.`,
        415
      )
    }

    const normalized = await pipeline
      .rotate()
      .resize({
        width: limits.maxDimension,
        height: limits.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()

    if (normalized.byteLength > limits.maxNormalizedBytes) {
      throw new ChatImageError(
        `"${file.clientName}" remains too large after image processing.`,
        413
      )
    }

    return { name: file.clientName, base64: normalized.toString('base64') }
  } catch (error) {
    if (error instanceof ChatImageError) throw error
    throw new ChatImageError(`"${file.clientName}" could not be decoded as an image.`, 422)
  }
}

/**
 * Put the images on the newest user message, in the form Ollama's chat API takes
 * them: an `images` array of base64 strings on the message. The oMLX proxy reads
 * the same field and turns it into the OpenAI image parts MLX expects.
 *
 * Images are not kept in the conversation. They ride with the one request that
 * carried them, so a follow-up question cannot refer back to them.
 *
 * Returns the same array when there is nothing to attach.
 */
export function attachImagesToLatestUserMessage<T extends { role: string }>(
  messages: T[],
  images: NormalizedChatImage[]
): Array<T & { images?: string[] }> {
  if (images.length === 0) return messages

  let latestUser = -1
  messages.forEach((message, index) => {
    if (message.role === 'user') latestUser = index
  })
  if (latestUser < 0) {
    throw new ChatImageError('Images require a user message.', 422)
  }

  return messages.map((message, index) =>
    index === latestUser ? { ...message, images: images.map((image) => image.base64) } : message
  )
}
