/**
 * Display version for a container image reference, used by both Supply Depot
 * surfaces (settings/apps.tsx table + SupplyDepotCard). An image ref is
 * `[registry[:port]/]name[:tag][@digest]`. We split off any digest first, then
 * read the tag after the LAST '/' (a registry port also uses ':'). A raw 64-char
 * digest is never surfaced as a "version": a digest pin (or a digest-shaped tag)
 * collapses to a short 12-char id, the Docker convention.
 *
 * Pure / import-free so it is shared (one source of truth) and standalone-testable.
 */
export function extractTag(containerImage: string): string {
  if (!containerImage) return ''
  const [ref, digest] = containerImage.split('@')
  const name = ref.slice(ref.lastIndexOf('/') + 1)
  const colon = name.indexOf(':')
  const tag = colon >= 0 ? name.slice(colon + 1) : ''
  if (tag) return /^[0-9a-f]{32,}$/i.test(tag) ? tag.slice(0, 12) : tag
  if (digest) return digest.replace(/^sha256:/, '').slice(0, 12)
  return 'latest'
}
