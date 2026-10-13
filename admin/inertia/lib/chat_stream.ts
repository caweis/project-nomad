/**
 * Reading a refusal from the chat endpoint (upstream edbfe1ad).
 *
 * Most chat failures have nothing useful to say, and the page words them itself.
 * A few the server can explain precisely: an image that is too large, a model
 * that cannot take images. Those arrive with a `message`, and the person should
 * read it as written, not wrapped in advice about the model not being installed.
 *
 * Pure, so it can be checked without a browser.
 */

const GENERIC_CHAT_STREAM_ERROR = 'The model encountered an error. Please try again.'

/** Statuses the chat endpoint uses when it explains a refusal itself. */
const EXPLAINED_STATUSES = new Set([413, 415, 422])

/**
 * A failure the server described. Shown to the person verbatim; anything else
 * is worded by the page (see chatFailureText in the chat component).
 */
export class ChatRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatRejectedError'
  }
}

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

/**
 * The error to throw for an event in the reply stream, or null when the event is
 * not an error. A stream error that carries a message was explained by the
 * server; one that does not is the model failing mid-reply.
 */
export function chatStreamError(event: unknown): Error | null {
  if (!event || typeof event !== 'object' || !('error' in event) || !event.error) return null
  const message = 'message' in event ? event.message : undefined
  return hasText(message) ? new ChatRejectedError(message) : new Error(GENERIC_CHAT_STREAM_ERROR)
}

/**
 * The error to throw for a chat request the server answered with a failure
 * status. Only the statuses the endpoint uses to explain itself are believed;
 * any other failure keeps the plain status, as it always has.
 */
export async function chatHttpError(response: {
  status: number
  json: () => Promise<unknown>
}): Promise<Error> {
  const plain = new Error(`HTTP error: ${response.status}`)
  if (!EXPLAINED_STATUSES.has(response.status)) return plain
  const body = await response.json().catch(() => null)
  const message =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message?: unknown }).message
      : undefined
  return hasText(message) ? new ChatRejectedError(message) : plain
}
