/**
 * Pure helper that rewrites the host side of a service's storage bind mounts so
 * they point at the resolved host storage root. Extracted from DockerService so
 * it can be unit-tested under `node --experimental-strip-types` without booting
 * Adonis or inspecting a live admin container.
 *
 * Ported from upstream commit 32e0694 (fix(storage): derive child-app bind
 * paths from the admin's actual storage mount, #938). The fork keeps the method
 * `DockerService._applyHostStorageRoot` as the wrapper that resolves the root
 * (via a Docker inspect) and feeds it here.
 */

/**
 * Rewrite the host-side prefix of each storage bind so it lives under `root`.
 *
 * Bind format: "<hostSrc>:<containerDest>[:opts]" — hostSrc is an absolute path.
 * Only binds whose host source equals `seededRoot` or sits under `seededRoot/`
 * are rewritten; everything else (the Docker socket, custom-app binds outside
 * the storage tree) is left untouched. No-op when `root === seededRoot`, which
 * is the common case (default installs), so this never disturbs them.
 *
 * @param binds      the HostConfig.Binds array (may be undefined/empty)
 * @param root       the resolved host storage root to rewrite prefixes to
 * @param seededRoot the prefix the binds were seeded with (NOMAD_STORAGE_PATH)
 * @returns a new binds array with prefixes rewritten, or the input unchanged
 */
export function rewriteStorageBinds(
  binds: string[] | undefined,
  root: string,
  seededRoot: string
): string[] | undefined {
  if (!binds?.length) return binds
  if (root === seededRoot) return binds
  return binds.map((b) => {
    const firstColon = b.indexOf(':')
    if (firstColon < 0) return b
    const hostSrc = b.slice(0, firstColon)
    const rest = b.slice(firstColon) // includes leading ':'
    if (hostSrc === seededRoot || hostSrc.startsWith(seededRoot + '/')) {
      return `${root}${hostSrc.slice(seededRoot.length)}${rest}`
    }
    return b
  })
}
