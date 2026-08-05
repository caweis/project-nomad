/**
 * Decide which URL/version to download for a curated ZIM resource.
 *
 * Curated manifests pin dated ZIM URLs (…/wikipedia_en_all_mini_2025-12.zim).
 * Kiwix rotates filenames and deletes old files, so a pinned URL can start
 * returning 404 long before the manifest JSON is refreshed. When a live
 * catalog entry for the same book is available, prefer it — unless the
 * manifest is somehow NEWER than the catalog (a temporary catalog lag), in
 * which case the manifest wins.
 *
 * Fork note (vs upstream #1091): the lookup itself runs against the Kiwix
 * OPDS catalog (see ZimService.getLatestCatalogEntries) rather than a
 * KiwixCatalogService, and there is no size passthrough — our download job
 * derives byte totals from the HTTP Content-Length at download time.
 *
 * Pure and dependency-free so it can run under the standalone test harness.
 * (The type-only SpecResource import below is erased at compile time.)
 */

import type { SpecResource } from '../../types/collections.js'

export type ZimCatalogResult = {
  version: string
  download_url: string
}

export type ResolvedZimDownload = {
  url: string
  version: string
}

/**
 * Compare `YYYY-M` / `YYYY-MM` versions numerically so 2026-10 sorts after
 * 2026-2 (lexicographic comparison gets that wrong). Anything unparseable
 * falls back to localeCompare.
 */
function compareZimVersions(left: string, right: string): number {
  const parse = (value: string): [number, number] | null => {
    const match = /^(\d{4})-(\d{1,2})$/.exec(value)
    if (!match) return null

    const month = Number.parseInt(match[2], 10)
    if (month < 1 || month > 12) return null

    return [Number.parseInt(match[1], 10), month]
  }

  const leftParts = parse(left)
  const rightParts = parse(right)
  if (!leftParts || !rightParts) return left.localeCompare(right)

  return leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1]
}

export function resolveZimDownload(
  resource: { url: string; version: string; auth?: SpecResource['auth'] },
  latest: ZimCatalogResult | null
): ResolvedZimDownload {
  // Gated, self-hosted content (upstream #1172) is pinned to the manifest URL,
  // never the Kiwix catalog. It isn't in the openzim catalog at all, so this is
  // normally a no-op — but a resource-id collision would otherwise silently
  // redirect a gated download to a third-party mirror, losing both the auth
  // header and any guarantee about what the bytes are.
  //
  // Consequence, stated rather than implied: gated content does NOT participate
  // in catalog-driven auto-update. New versions ship by bumping the manifest.
  //
  // The check is inlined (not imported from hosted_content.ts) so this module
  // keeps zero runtime imports for the standalone harness; the SpecResource
  // literal type keeps both sites compiler-checked against the same value.
  if (resource.auth === 'nomad_app_key') {
    return {
      url: resource.url,
      version: resource.version,
    }
  }

  if (!latest || compareZimVersions(latest.version, resource.version) < 0) {
    return {
      url: resource.url,
      version: resource.version,
    }
  }

  return {
    url: latest.download_url,
    version: latest.version,
  }
}
