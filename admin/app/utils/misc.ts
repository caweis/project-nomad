// Choose the unit after rounding so 1023.6 B/s becomes 1.0 KB/s.
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s'
  if (Math.round(bytesPerSecond) < 1024) return `${Math.round(bytesPerSecond)} B/s`
  const kb = bytesPerSecond / 1024
  if (Math.round(kb * 10) / 10 < 1024) return `${kb.toFixed(1)} KB/s`
  return `${(kb / 1024).toFixed(1)} MB/s`
}

export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    return lower === 'true' || lower === '1'
  }
  if (typeof value === 'number') {
    return value === 1
  }
  return false
}