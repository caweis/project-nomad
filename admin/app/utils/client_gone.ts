/**
 * Whether the person who sent a request has already gone.
 *
 * Node marks the response, and its socket, as destroyed when the client
 * disconnects. A 'close' listener attached after that never fires, so work that
 * only starts listening late has to look. Pictures make the gap long: they are
 * resized, and the model is asked what it can do, before the controller starts
 * watching for the reader to leave. Without a look, someone who pressed Stop in
 * that time still gets an answer generated for nobody, and saved to the
 * conversation.
 *
 * Pure and import-free.
 */
export function clientHasLeft(response: {
  destroyed?: boolean
  socket?: { destroyed?: boolean } | null
}): boolean {
  return response.destroyed === true || response.socket?.destroyed === true
}
