/**
 * Canonical host-command-bridge command names — single source of truth for the
 * backend allow-list (HostCommandsController.ALLOWED_COMMANDS) and the frontend
 * button type (HostCommandName).
 *
 * The host-side action map — run_cmd()'s `case` in install/macos/nomad — maps
 * each of these names to a host action and is the bridge's SECURITY BOUNDARY.
 * It is hand-authored (deliberately not generated) and kept in sync with this
 * list by install/macos/scripts/test-host-command-allowlist.sh (run in CI).
 */
export const HOST_COMMANDS = [
  'upgrade-ollama',
  'upgrade-omlx',
  'upgrade-admin',
  'upgrade-all',
  'reset-ollama',
  'fix-kiwix',
  'adopt-drive',
  'self-update',
  'mesh-bridge-restart',
] as const

export type HostCommandName = (typeof HOST_COMMANDS)[number]
