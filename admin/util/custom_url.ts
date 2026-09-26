/**
 * The one set of rules for a user-typed URL that NOMAD will later put in an href:
 * an app's custom launch URL, and a home-screen link tile.
 *
 * Accepts a bare host or a full URL, and prepends http:// when there is no scheme,
 * because a LAN device is usually reached as "192.168.1.50:8080". Returns the
 * normalized href, or null when the input is empty or not a valid http(s) URL.
 *
 * Restricting the result to http and https is a security boundary, not tidiness:
 * it is what keeps `javascript:` and `data:` out of a stored href. Those are
 * refused because prefixing http:// leaves a non-numeric "port", which makes
 * new URL() throw.
 *
 * The result must also fit services.custom_url, a VARCHAR(255). Prepending a
 * scheme or canonicalizing can make a valid-looking input longer than what was
 * typed, so the normalized value is what gets measured (upstream ce60e063).
 *
 * Shared by the validator (backend) and the link-tile form (frontend), so the
 * preview a user sees is exactly what the server will accept. Upstream keeps two
 * copies of this function, one on each side; one copy cannot drift.
 */
export const CUSTOM_URL_MAX_LENGTH = 255

/**
 * Why a typed URL cannot be stored. `empty` is kept apart from the others because
 * callers read it differently: clearing an app's launch URL is allowed, and a link
 * tile without one is simply not ready to save.
 */
export type CustomUrlProblem = 'empty' | 'invalid' | 'too_long'

/** Normalize a typed URL, and say why when there is nothing that can be stored. */
export function checkCustomUrl(
  input: string | null | undefined
): { href: string; problem: null } | { href: null; problem: CustomUrlProblem } {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return { href: null, problem: 'empty' }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { href: null, problem: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { href: null, problem: 'invalid' }
  }
  if (url.href.length > CUSTOM_URL_MAX_LENGTH) return { href: null, problem: 'too_long' }
  return { href: url.href, problem: null }
}

export function normalizeCustomUrl(input: string | null | undefined): string | null {
  return checkCustomUrl(input).href
}

/**
 * What to tell someone whose link URL was refused, in the same words from the form
 * and the server. A URL that is merely too long gets its own message: "Enter a
 * valid URL" would send them looking for a mistake that is not there.
 */
export const CUSTOM_URL_MESSAGES = {
  invalid: 'Enter a valid URL, for example 192.168.1.50:8080 or https://nas.local.',
  too_long: `That URL is too long to save. The limit is ${CUSTOM_URL_MAX_LENGTH} characters.`,
} as const
