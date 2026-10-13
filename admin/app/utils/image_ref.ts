/**
 * Builds the image reference an update pulls: the current image's repository
 * (registry/name, minus any existing tag) at the new `targetVersion` tag.
 *
 * This is the single source of truth for that construction so the auto-update
 * disk pre-flight sizes the exact ref that DockerService.updateContainer later
 * pulls — the two can't drift. Pure and dependency-free for standalone testing.
 *
 * Strip a digest first. A colon denotes a tag only when it appears after the
 * last slash; one in the registry host belongs to its port instead.
 */
export function buildUpdatedImageRef(currentImage: string, targetVersion: string): string {
  const withoutDigest = currentImage.split('@', 1)[0]
  const lastColon = withoutDigest.lastIndexOf(':')
  const lastSlash = withoutDigest.lastIndexOf('/')
  const imageBase = lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest
  return `${imageBase}:${targetVersion}`
}
