import { load } from 'cheerio'
import { assertNotPrivateUrl } from '../validators/common.js'

export type LibraryDirectory = { name: string; path: string }
export type LibraryFile = { name: string; url: string; size_bytes: number | null }
export type LibraryListing = { directories: LibraryDirectory[]; files: LibraryFile[] }

export function normalizeLibraryBaseUrl(input: string): string {
  const url = new URL(input.trim())
  assertNotPrivateUrl(url.toString())
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Library URL must not contain credentials, a query, or a fragment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

export function resolveLibraryPath(baseUrl: string, path: string): string {
  const base = new URL(normalizeLibraryBaseUrl(baseUrl))
  if (path.startsWith('/') || path.startsWith('\\')) {
    throw new Error('Library path must be relative')
  }
  const target = new URL(path || '.', base)
  if (
    target.origin !== base.origin ||
    !target.pathname.startsWith(base.pathname) ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new Error('Library path must stay under its saved source')
  }
  return target.toString()
}

function parseListingSize(text: string): number | null {
  const token = /(?:^|\s)(\d+(?:\.\d+)?)([KMGT]?)(?:B)?$/i.exec(text.split('\n')[0].trim())
  if (!token) return null
  const multiplier: Record<string, number> = {
    '': 1,
    'K': 1024,
    'M': 1024 ** 2,
    'G': 1024 ** 3,
    'T': 1024 ** 4,
  }
  const bytes = Number(token[1]) * multiplier[token[2].toUpperCase()]
  return Number.isSafeInteger(Math.round(bytes)) ? Math.round(bytes) : null
}

export function parseLibraryListing(
  html: string,
  currentUrl: string,
  baseUrl: string
): LibraryListing {
  const base = new URL(normalizeLibraryBaseUrl(baseUrl))
  const requested = new URL(currentUrl)
  if (requested.origin !== base.origin || !requested.pathname.startsWith(base.pathname)) {
    throw new Error('Current library directory must stay under its saved source')
  }
  const current = new URL(
    resolveLibraryPath(base.toString(), requested.pathname.slice(base.pathname.length))
  )
  const directories: LibraryDirectory[] = []
  const files: LibraryFile[] = []
  const seen = new Set<string>()
  const $ = load(html)

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')
    if (!href || href.startsWith('?') || href.startsWith('#')) return
    let target: URL
    try {
      target = new URL(href, current)
    } catch {
      return
    }
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith(base.pathname) ||
      target.search ||
      target.hash ||
      target.pathname === current.pathname ||
      seen.has(target.toString())
    )
      return

    let name: string
    try {
      name = decodeURIComponent(target.pathname.split('/').filter(Boolean).at(-1) || '')
    } catch {
      return
    }
    if (!name) return
    seen.add(target.toString())
    if (target.pathname.endsWith('/')) {
      directories.push({ name, path: target.pathname.slice(base.pathname.length) })
      return
    }
    if (!target.pathname.toLowerCase().endsWith('.zim')) return

    let trailingText = ''
    let sibling = element.next
    while (sibling?.type === 'text') {
      trailingText += sibling.data
      if (sibling.data.includes('\n')) break
      sibling = sibling.next
    }
    files.push({ name, url: target.toString(), size_bytes: parseListingSize(trailingText) })
  })

  directories.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { directories, files }
}
