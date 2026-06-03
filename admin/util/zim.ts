import axios from 'axios'
import { RawListRemoteZimFilesResponse, RawRemoteZimFileEntry } from '../types/zim.js'

/**
 * Classifies an error thrown while fetching the remote OPDS catalog.
 *
 * NOMAD is an offline-first appliance, so the mini frequently has no WAN — and
 * even when it does, the upstream Kiwix library can be unreachable or return a
 * non-2xx status (e.g. 503). Both are transport failures of "reach the catalog
 * over the internet", not bugs in our code.
 *
 * Returns a short, human-readable reason when the failure is such a transport
 * error (connection refused / DNS / timeout, or any HTTP error response), so the
 * caller can surface a calm "catalog unavailable" state. Returns null when the
 * error is NOT an Axios transport error — those are genuine internal faults
 * (e.g. malformed XML, local filesystem errors) and must keep propagating.
 */
export function classifyCatalogFetchError(error: unknown): string | null {
  if (!axios.isAxiosError(error)) {
    return null
  }
  if (error.response) {
    // Upstream was reachable but returned an error status (503, 502, 4xx, …).
    return `upstream responded ${error.response.status}`
  }
  // No response at all — connection/DNS/timeout (ECONNREFUSED, ENOTFOUND,
  // EAI_AGAIN, ETIMEDOUT, …). error.code carries the OS-level reason.
  return `network unreachable (${error.code ?? 'unknown'})`
}

export function isRawListRemoteZimFilesResponse(obj: any): obj is RawListRemoteZimFilesResponse {
  if (!(obj && typeof obj === 'object' && 'feed' in obj)) {
    return false
  }
  if (!obj.feed || typeof obj.feed !== 'object') {
    return false
  }
  if (!('entry' in obj.feed)) {
    return true // entry is optional and may be missing if there are no results
  }

  if ('entry' in obj.feed && typeof obj.feed.entry !== 'object') {
    return false // If entry exists, it must be an object or array
  }

  return true
}

export function isRawRemoteZimFileEntry(obj: any): obj is RawRemoteZimFileEntry {
  return obj && typeof obj === 'object' && 'id' in obj && 'title' in obj && 'summary' in obj
}
