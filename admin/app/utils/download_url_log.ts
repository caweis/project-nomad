/** Only the origin is safe to show when a download URL may contain credentials. */
export function downloadUrlOriginForLog(value: unknown): string {
  if (typeof value !== 'string') return '[invalid download URL]'

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : '[invalid download URL]'
  } catch {
    return '[invalid download URL]'
  }
}

export function downloadFailureForDisplay(reason: string): string {
  if (reason.startsWith('This content is gated behind an entitlement key')) {
    return 'This content requires an entitlement key. Check the hosted content key on this install.'
  }
  if (reason.startsWith('Not enough free disk space:'))
    return 'Not enough free disk space. Free some space and retry; NOMAD leaves 2 GiB free.'
  if (reason.startsWith('Download cancelled:')) return 'Download cancelled.'
  return 'Download failed. Retry or check the server logs.'
}
