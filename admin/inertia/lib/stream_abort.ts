/**
 * Ownership rules for the chat reply stream (caweis#51).
 *
 * Chat held an AbortController for each streaming reply and never called
 * abort() on it. Walking away from a reply left the fetch running: the browser
 * keeps a connection occupied, and the server keeps decoding into a response
 * nobody is reading — which with a single Ollama slot is the next message
 * waiting behind an answer that was already abandoned.
 *
 * The second rule here is the subtler one. The stream's `finally` used to clear
 * the shared streaming state unconditionally, so a stale stream finishing after
 * a newer one had started would turn off the spinner for a reply still
 * arriving.
 *
 * Kept as plain functions with no React import so they can be exercised under
 * bare `node --experimental-strip-types`; the effect wiring that calls them is
 * the part a device pass has to confirm.
 */

/** The mutable ref shape React gives us, without importing React for it. */
export type ControllerRef = { current: AbortController | null }

/**
 * Abort whatever stream is running and clear the slot.
 *
 * Returns true when it actually aborted something, which is what makes this
 * observable in a test. Safe to call when nothing is running, and safe to call
 * twice — an already-aborted controller is left alone rather than re-aborted.
 */
export function abortActiveStream(ref: ControllerRef): boolean {
  const controller = ref.current
  if (!controller) return false
  ref.current = null
  if (controller.signal.aborted) return false
  controller.abort()
  return true
}

/**
 * Whether `candidate` is still the stream the UI is showing.
 *
 * Only the owning stream may clear shared state. Anything else finishing is a
 * straggler whose result is no longer on screen.
 */
export function ownsStream(ref: ControllerRef, candidate: AbortController): boolean {
  return ref.current === candidate
}

/**
 * Claim the slot for a new stream, aborting any predecessor first.
 *
 * Returns the controller to use. Starting a reply while one is still running
 * means the earlier answer is no longer wanted, so it is cancelled rather than
 * left to finish into a UI that has moved on.
 */
export function claimStream(ref: ControllerRef): AbortController {
  abortActiveStream(ref)
  const controller = new AbortController()
  ref.current = controller
  return controller
}
