/** The final path component of a download URL, without query or fragment. */
export function filenameFromDownloadUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    return pathname.slice(pathname.lastIndexOf('/') + 1) || null
  } catch {
    return null
  }
}
