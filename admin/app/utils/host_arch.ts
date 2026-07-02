import type { DockerService } from '#services/docker_service'

/**
 * Maps a Docker `info().Architecture` value (uname-style: "x86_64", "aarch64",
 * "armv7l") to the OCI platform arch ("amd64", "arm64", "arm") used for registry
 * manifest lookups. Pure and dependency-free, so it's unit-testable under
 * `node --experimental-strip-types` (the `import type` above is erased). Values
 * already in OCI form pass through; anything unrecognized falls through
 * lowercased rather than guessing.
 */
export function mapDockerArch(dockerArch: string): string {
  const archMap: Record<string, string> = {
    x86_64: 'amd64',
    aarch64: 'arm64',
    armv7l: 'arm',
    amd64: 'amd64',
    arm64: 'arm64',
  }
  return archMap[dockerArch] || (dockerArch || '').toLowerCase()
}

/**
 * Best-effort host architecture in OCI form via the Docker daemon's `info()`.
 * Never throws: a daemon/info hiccup falls back to 'amd64' (the safe default for
 * manifest lookups) and reports through the optional `warn` callback. Callers
 * inject `warn` (rather than importing the logger here) so the pure mapping
 * above stays runtime-free.
 */
export async function resolveHostArch(
  dockerService: DockerService,
  warn?: (message: string) => void
): Promise<string> {
  try {
    const info = await dockerService.docker.info()
    return mapDockerArch(info.Architecture || '')
  } catch (error) {
    warn?.(
      `Could not detect host architecture: ${(error as Error).message}. Defaulting to amd64.`
    )
    return 'amd64'
  }
}
