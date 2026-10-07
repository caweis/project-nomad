/**
 * A chat request that carries images is multipart, because JSON cannot carry
 * files (upstream edbfe1ad). The usual request body travels in one form field
 * called `payload`, as JSON text, beside the image files.
 *
 * Reading it is kept apart from the controller so the refusals can be checked
 * without an HTTP server. Pure and import-free.
 */
export type MultipartChatPayload = { ok: true; payload: unknown } | { ok: false; message: string }

export function readMultipartChatPayload(raw: unknown): MultipartChatPayload {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Multipart chat requests require a JSON payload.' }
  }
  try {
    return { ok: true, payload: JSON.parse(raw) }
  } catch {
    return { ok: false, message: 'The multipart chat payload is not valid JSON.' }
  }
}
