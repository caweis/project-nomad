/**
 * Docker bind mounts as the Edit dialog shows them.
 *
 * A bind is `host:container`, or `host:container:options` where the options are
 * things like `ro`, `rw`, `z` or `ro,z`. The dialog has two fields per mount, a
 * host path and a container path, and its validator refuses a colon in either:
 * a colon is Docker's delimiter, so a path holding one could be read as a
 * different mount than the one checked.
 *
 * Splitting at the first colon only put the options into the container path.
 * MeshCore Web mounts its nginx config and certificates read-only, so its
 * dialog showed `/certs:ro`, which the validator then refused, and the app
 * could not be saved. The options are now kept out of the dialog and put back
 * on the way out.
 *
 * Pure and import-free.
 */
export type Volume = { host_path: string; container_path: string }

/** The two paths of each mount, without its options. */
export function volumesFromBinds(binds: string[]): Volume[] {
  return binds.map((bind) => {
    const [hostPath = '', containerPath = ''] = bind.split(':')
    return { host_path: hostPath, container_path: containerPath }
  })
}

/**
 * Binds for a saved dialog. A mount whose host and container paths are both
 * unchanged keeps the options it had. One that was changed is a new mount and
 * starts with Docker's defaults, and options never move to another mount.
 */
export function bindsFromVolumes(volumes: Volume[], existingBinds: string[]): string[] {
  const optionsByMount = new Map<string, string>()
  for (const bind of existingBinds) {
    const [host, container, ...options] = bind.split(':')
    if (options.length > 0) optionsByMount.set(`${host}\u0000${container}`, options.join(':'))
  }
  return volumes.map(({ host_path: hostPath, container_path: containerPath }) => {
    const options = optionsByMount.get(`${hostPath}\u0000${containerPath}`)
    return options ? `${hostPath}:${containerPath}:${options}` : `${hostPath}:${containerPath}`
  })
}
