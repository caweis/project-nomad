/**
 * Pure helpers for turning the Docker daemon's platform strings into the fields
 * a benchmark result records (fork port of upstream #1158).
 *
 * The daemon is deliberately the source: inside the admin container `os.arch()`
 * and `si.osInfo()` describe the CONTAINER, not the machine being benchmarked.
 * On this fork the daemon lives in a macOS container VM (OrbStack on the
 * supported install), which bounds what is truthfully knowable:
 *
 *   - Architecture   'aarch64' — the VM runs natively on the host CPU, so this
 *                    IS the Mac's silicon. Mapped to OCI form ('arm64') by the
 *                    existing `mapDockerArch` in ./host_arch.ts (not duplicated
 *                    here — that util is the canonical arch mapping).
 *   - OperatingSystem / OSVersion — the DOCKER HOST's OS as the daemon reports
 *                    it. On macOS engines that is the Linux VM ('OrbStack',
 *                    'Docker Desktop'), NOT macOS: the macOS version is not
 *                    visible from inside the container and we do not fabricate
 *                    it. On a plain Linux host it is the real distro
 *                    ('Ubuntu 24.04.4 LTS').
 *   - KernelVersion / Name — VM markers ('6.x-orbstack-…', 'linuxkit',
 *                    hostname 'orbstack' / 'docker-desktop' / 'colima').
 *
 * Zero imports on purpose: keeps these unit-testable under
 * `node --experimental-strip-types` without a Docker daemon.
 */

/**
 * Split the distro name out of the daemon's free-form OperatingSystem string.
 *
 * `OperatingSystem` is a description ('Ubuntu 24.04.4 LTS') while `OSVersion`
 * is structured ('24.04'). Taking the text before the version yields the name
 * without hand-maintaining a list of distributions:
 *
 *   'Ubuntu 24.04.4 LTS'             + '24.04' -> 'Ubuntu'
 *   'Debian GNU/Linux 12 (bookworm)' + '12'    -> 'Debian GNU/Linux'
 *   'OrbStack'                       + null    -> 'OrbStack'
 *
 * Falls back to the full description whenever the version is missing, empty,
 * or doesn't appear in the string. An over-long name is harmless; a wrong one
 * is not, and silently truncating an unfamiliar string would be worse than
 * leaving it verbose. (Ported from upstream #1158.)
 */
export function deriveOsName(operatingSystem: string, osVersion: string | null): string {
  const description = operatingSystem.trim()
  if (!osVersion) return description

  const version = osVersion.trim()
  if (version === '') return description

  const idx = description.indexOf(version)
  // idx === 0 means the string starts with the version and has no name to take.
  if (idx <= 0) return description

  const name = description.slice(0, idx).trim()
  return name.length > 0 ? name : description
}

/**
 * Identify which container engine/VM flavor is running the Docker daemon —
 * the fork's honest analog of upstream's WSL2-vs-native `run_environment`
 * (a fork-specific addition; upstream #1158 has no equivalent because their
 * hosts run the daemon directly on Linux).
 *
 * Only asserts what a marker proves:
 *
 *   'orbstack'       OperatingSystem/kernel mention OrbStack, or the daemon
 *                    hostname is 'orbstack'
 *   'docker-desktop' OperatingSystem says Docker Desktop, kernel is linuxkit,
 *                    or hostname is 'docker-desktop'
 *   'colima'         hostname 'colima' (its VM reports a plain Ubuntu OS
 *                    string, so the hostname is the only reliable marker)
 *   'lima'           hostname 'lima-<vm>'
 *   null             no marker recognized — including a genuine Linux host.
 *                    We cannot distinguish "real Linux box" from "a VM distro
 *                    we don't know" using daemon strings alone, so we record
 *                    nothing rather than guess.
 */
export function detectContainerEngine(
  operatingSystem: string | null,
  kernelVersion: string | null,
  daemonName: string | null
): string | null {
  const os = (operatingSystem ?? '').toLowerCase()
  const kernel = (kernelVersion ?? '').toLowerCase()
  const name = (daemonName ?? '').trim().toLowerCase()

  if (os.includes('orbstack') || kernel.includes('orbstack') || name === 'orbstack') {
    return 'orbstack'
  }
  if (os.includes('docker desktop') || kernel.includes('linuxkit') || name === 'docker-desktop') {
    return 'docker-desktop'
  }
  if (name === 'colima' || kernel.includes('colima')) {
    return 'colima'
  }
  if (name.startsWith('lima-')) {
    return 'lima'
  }
  return null
}
