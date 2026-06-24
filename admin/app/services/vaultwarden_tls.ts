/**
 * Pure decision for the boot-time Vaultwarden HTTPS migration (see
 * DockerService.reconcileVaultwardenTls). Kept pure and dependency-free so the
 * decision can be unit-tested without a Docker socket.
 *
 * Returns true only for an installed Vaultwarden whose running container does
 * NOT yet carry a ROCKET_TLS env var — i.e. an install that predates HTTPS,
 * whose catalog row was reseeded to the TLS config on upgrade but whose live
 * container is still on the old plain-HTTP config and needs recreating.
 */
export function vaultwardenNeedsTlsMigration(opts: {
  installed: boolean
  hasContainer: boolean
  containerEnv: string[]
}): boolean {
  if (!opts.installed) return false
  if (!opts.hasContainer) return false
  return !opts.containerEnv.some((e) => e.startsWith('ROCKET_TLS='))
}
