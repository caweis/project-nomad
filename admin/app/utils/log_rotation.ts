// Adapted from Crosstalk-Solutions/project-nomad 6193caf1.
// DockerService supplies the daemon driver and applies this policy on create/recreate.

export const LOG_MAX_SIZE = '10m'
export const LOG_MAX_FILE = '3'

export type LogConfig = { Type?: string; Config?: Record<string, string> }

/** Bound json-file logs, preserving explicit drivers and existing size limits. */
export function withLogRotation(
  existing: LogConfig | undefined,
  daemonDefaultDriver: string | undefined
): LogConfig | undefined {
  const driver = existing?.Type || daemonDefaultDriver
  if (driver !== 'json-file') return existing

  const config = existing?.Config ?? {}
  if (config['max-size']) return existing

  return {
    Type: 'json-file',
    Config: { 'max-file': LOG_MAX_FILE, ...config, 'max-size': LOG_MAX_SIZE },
  }
}
