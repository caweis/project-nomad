/**
 * Pure port-allocation helpers for custom apps.
 *
 * Extracted from the (Docker-touching) `SystemService.getNextSuggestedCustomPort` and the
 * controller's duplicate-host-port guard so the arithmetic is single-sourced and exercisable
 * under `node --experimental-strip-types` (the surrounding methods hit the Docker socket / DB,
 * which can't run in that harness). The callers gather the occupied/host-port sets from Docker
 * and the request, then defer the decision to these.
 */

/** First custom-app host port. Custom apps are suggested in the 8600+ band, stepping by 10. */
export const CUSTOM_PORT_START = 8600

/**
 * Next free host port at or after CUSTOM_PORT_START, stepping by 10, skipping any in `occupied`.
 */
export function nextFreeCustomPort(occupied: ReadonlySet<number>): number {
  let candidate = CUSTOM_PORT_START
  while (occupied.has(candidate)) candidate += 10
  return candidate
}

/**
 * Host ports that appear more than once in a request. Docker would otherwise fail at create time
 * (a host port can map to only one container), so the controller rejects these up front.
 */
export function findDuplicateHostPorts(hostPorts: number[]): number[] {
  return [...new Set(hostPorts.filter((p, i) => hostPorts.indexOf(p) !== i))]
}
