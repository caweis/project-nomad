/**
 * Builds the image reference an update pulls: the current image's repository
 * (registry/name, minus any existing tag) at the new `targetVersion` tag.
 *
 * This is the single source of truth for that construction so the auto-update
 * disk pre-flight sizes the exact ref that DockerService.updateContainer later
 * pulls — the two can't drift. Pure and dependency-free for standalone testing.
 *
 * Caveat (preserved from the original inline logic): it splits on the LAST ':'.
 * A registry `host:port` with no tag would be mis-split, and a digest-pinned
 * (`@sha256:…`) ref is not handled. Update tags come from getAvailableUpdates
 * (always tag-form, no port/digest), so this matches the exercised path; it is
 * intentionally not broadened here to avoid changing update behavior.
 */
export function buildUpdatedImageRef(currentImage: string, targetVersion: string): string {
  const imageBase = currentImage.includes(':')
    ? currentImage.substring(0, currentImage.lastIndexOf(':'))
    : currentImage
  return `${imageBase}:${targetVersion}`
}
