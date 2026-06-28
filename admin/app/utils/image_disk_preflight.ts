import type { ContainerRegistryService } from '#services/container_registry_service'
import type { SystemService } from '#services/system_service'

/**
 * Shared disk pre-flight for the opt-in auto-update tiers (core app + installed
 * apps). Framework-light (plain functions + injected service instances) so the
 * decision is unit-testable under `node --experimental-strip-types`: the only
 * runtime dependency would be the Adonis logger, so callers inject a `warn`
 * callback instead. The `import type` service deps are erased at strip time.
 *
 * Ported from upstream v1.33.0 (admin/app/utils/image_disk_preflight.ts), with
 * the logger import swapped for the injected `warn`.
 */

export type BlockerSeverity = 'skip' | 'failure'

export interface Blocker {
  reason: string
  severity: BlockerSeverity
}

export interface PreflightResult {
  ok: boolean
  blockers: Blocker[]
}

/** Require free space >= imageSize * factor to cover decompressed layers + headroom. */
export const DISK_SAFETY_FACTOR = 2
/** Conservative fallback when the registry image size can't be determined. */
export const MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024 // 5 GiB

/** Free bytes on the root filesystem (best-effort, falls back to max available). */
export async function getFreeBytes(systemService: SystemService): Promise<number | null> {
  const info = await systemService.getSystemInfo()
  if (!info?.fsSize?.length) return null
  const root = info.fsSize.find((f) => f.mount === '/')
  if (root) return root.available
  return Math.max(...info.fsSize.map((f) => f.available))
}

function gib(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

/**
 * Returns a `failure` disk blocker if free space is insufficient for the given
 * image reference, otherwise null. Estimates the image's compressed download
 * size from the registry manifest, requires `size * DISK_SAFETY_FACTOR` (or
 * {@link MIN_FREE_BYTES} when size is unknown), and never blocks on transient
 * lookup errors (returns null) — an off-grid box must not auto-disable for a
 * flaky registry.
 *
 * @param image Full image reference INCLUDING tag (e.g. "ollama/ollama:0.23.2").
 */
export async function checkImageDiskSpace(params: {
  image: string
  hostArch: string
  containerRegistryService: ContainerRegistryService
  systemService: SystemService
  warn?: (message: string) => void
}): Promise<Blocker | null> {
  const { image, hostArch, containerRegistryService, systemService, warn } = params
  try {
    const parsed = containerRegistryService.parseImageReference(image)
    const imageSize = await containerRegistryService.getImageDownloadSize(
      parsed,
      parsed.tag,
      hostArch
    )
    const required = imageSize !== null ? imageSize * DISK_SAFETY_FACTOR : MIN_FREE_BYTES

    const free = await getFreeBytes(systemService)
    if (free === null) {
      warn?.('[ImageDiskPreflight] Could not determine free disk space; skipping disk check')
      return null
    }

    if (free < required) {
      return {
        reason: `Insufficient disk space: ${gib(free)} free, ${gib(required)} required`,
        severity: 'failure',
      }
    }
    return null
  } catch (error) {
    warn?.(`[ImageDiskPreflight] Disk space check failed: ${(error as Error).message}`)
    return null
  }
}
