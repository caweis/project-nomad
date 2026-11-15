export const DOWNLOAD_FREE_SPACE_HEADROOM_BYTES = 2 * 1024 ** 3

export function contentLength(value: unknown): number {
  const text = String(value ?? '')
  if (!/^\d+$/.test(text)) return 0
  const bytes = Number(text)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0
}

/** Only append a complete suffix of the same-sized representation. */
export function isMatchingResume(header: unknown, start: number, total: number): boolean {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(String(header ?? '').trim())
  if (!match) return false
  const [first, last, size] = match.slice(1).map(Number)
  return (
    [first, last, size].every(Number.isSafeInteger) &&
    first === start &&
    last >= first &&
    size > last &&
    last === size - 1 &&
    (total === 0 || size === total)
  )
}

export function hasRoomForDownload(remaining: number, free: number): boolean {
  return (
    Number.isFinite(remaining) &&
    remaining >= 0 &&
    Number.isFinite(free) &&
    remaining + DOWNLOAD_FREE_SPACE_HEADROOM_BYTES <= free
  )
}
