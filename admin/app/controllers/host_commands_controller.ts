import type { HttpContext } from '@adonisjs/core/http'
import { promises as fs } from 'fs'
import path from 'path'
import logger from '@adonisjs/core/services/logger'
import { HOST_COMMANDS } from '../../constants/host_commands.js'

/**
 * Bridge from admin UI to host-side `nomad` CLI commands.
 *
 * Admin runs inside a Docker container with no access to Homebrew or the
 * host's `nomad` binary. The host-side `com.projectnomad.host-command-bridge`
 * LaunchAgent (installed by `nomad install`) polls a directory on the
 * bind-mounted storage volume for marker files; when admin writes one, the
 * bridge runs the matching `nomad` command and writes a result file admin
 * polls for status.
 *
 * Protocol:
 * - POST /api/host-commands/:cmd
 *   Writes `/app/storage/.host-commands/<cmd>.pending`. Returns
 *   `{ status: "queued" }`. The :cmd parameter is validated against a strict
 *   allow-list — anything not on it returns 400.
 *
 * - GET /api/host-commands/:cmd
 *   Checks for `<cmd>.in-progress` (LaunchAgent is running it now) and
 *   `<cmd>.result` (LaunchAgent finished, exit code + output captured).
 *   Returns one of:
 *     { status: "idle" }                              — no recent activity
 *     { status: "pending" }                            — written, not yet picked up
 *     { status: "in-progress" }                        — bridge is running it
 *     { status: "completed", exit_code, output, ... } — done
 *
 * No token / auth: the bridge directory is on the user's bind-mounted
 * storage volume (file-system permissioned to the user). Anything writing
 * to it already has user-level access. The bridge's allow-list prevents
 * arbitrary shell injection.
 */
export default class HostCommandsController {
  // Canonical name list lives in constants/host_commands.ts; the bash run_cmd()
  // case in install/macos/nomad is the matching security boundary (kept in sync
  // by install/macos/scripts/test-host-command-allowlist.sh).
  private static readonly ALLOWED_COMMANDS = new Set<string>(HOST_COMMANDS)

  private static readonly BRIDGE_DIR = '/app/storage/.host-commands'

  public async dispatch({ params, response }: HttpContext) {
    const cmd = params.cmd as string
    if (!HostCommandsController.ALLOWED_COMMANDS.has(cmd)) {
      return response.status(400).json({
        error: 'Unknown command',
        allowed: Array.from(HostCommandsController.ALLOWED_COMMANDS),
      })
    }

    try {
      await fs.mkdir(HostCommandsController.BRIDGE_DIR, { recursive: true })
    } catch (err) {
      logger.error({ err }, '[HostCommands] failed to ensure bridge dir')
      return response.status(500).json({
        error: 'Bridge directory unavailable. Data drive may be unplugged.',
      })
    }

    const pendingPath = path.join(HostCommandsController.BRIDGE_DIR, `${cmd}.pending`)
    const startedAt = Math.floor(Date.now() / 1000)
    const payload = `cmd=${cmd}\nstarted_at=${startedAt}\n`

    try {
      // Write the marker file. Atomic enough for our purposes — the
      // LaunchAgent picks it up on its next 2s poll.
      await fs.writeFile(pendingPath, payload, { flag: 'w' })
      logger.info({ cmd, pendingPath }, '[HostCommands] queued')
      return response.json({ status: 'queued', cmd, started_at: startedAt })
    } catch (err) {
      logger.error({ err, cmd }, '[HostCommands] failed to write pending marker')
      return response.status(500).json({
        error: 'Could not queue command. Check admin logs.',
      })
    }
  }

  /**
   * Max age (seconds) of a .pending marker before we declare the host-side
   * LaunchAgent is missing / hung. The bridge polls every 2s, but the
   * command it then runs (e.g. `nomad upgrade admin`) can take 30-60+
   * seconds — `docker pull` + container recreate alone is regularly that
   * long. The original 30s threshold tripped during legitimate in-flight
   * commands and falsely told the user the bridge wasn't installed.
   *
   * Bumped to 300s (5 min): long enough to cover the slowest known
   * allow-listed command (`upgrade-all` can run several minutes when
   * multiple images pull), still short enough that a truly hung / missing
   * bridge surfaces a clear error within a reasonable window.
   *
   * Note: the bridge atomically renames .pending → .in-progress when it
   * picks up the marker, so the .pending lifetime is just "queue waiting
   * for the bridge's next 2s poll." In practice this should be sub-2s.
   * The 300s is a safety net for the case where the bridge daemon is
   * actually wedged.
   */
  private static readonly PENDING_STALE_AFTER_SECONDS = 300

  public async status({ params, response }: HttpContext) {
    const cmd = params.cmd as string
    if (!HostCommandsController.ALLOWED_COMMANDS.has(cmd)) {
      return response.status(400).json({ error: 'Unknown command' })
    }

    const inProgressPath = path.join(HostCommandsController.BRIDGE_DIR, `${cmd}.in-progress`)
    const pendingPath = path.join(HostCommandsController.BRIDGE_DIR, `${cmd}.pending`)
    const resultPath = path.join(HostCommandsController.BRIDGE_DIR, `${cmd}.result`)

    // in-progress takes precedence (the LaunchAgent renames .pending → .in-progress atomically)
    if (await this.exists(inProgressPath)) {
      return response.json({ status: 'in-progress', cmd })
    }
    if (await this.exists(pendingPath)) {
      // If the .pending file has sat there longer than the bridge's polling
      // window, the host-side LaunchAgent isn't installed (or isn't running).
      // Return a clear error instead of letting the UI spin forever.
      try {
        const stat = await fs.stat(pendingPath)
        const ageSeconds = (Date.now() - stat.mtimeMs) / 1000
        if (ageSeconds > HostCommandsController.PENDING_STALE_AFTER_SECONDS) {
          logger.warn(
            { cmd, ageSeconds, pendingPath },
            '[HostCommands] pending marker is stale — host-command-bridge LaunchAgent appears not to be running'
          )
          // Clean up the stale marker so a future click can retry cleanly
          await fs.unlink(pendingPath).catch(() => {})
          return response.json({
            status: 'bridge-not-installed',
            cmd,
            help: 'The host-side command bridge is not running on this Mac. From Terminal, run `nomad install-bridge` to install the LaunchAgent. Or run `nomad upgrade ollama` (and similar commands) directly from Terminal — that path always works.',
          })
        }
      } catch {
        // If we can't stat the file (race with the LaunchAgent picking it up),
        // fall through to reporting pending and let the next poll resolve it
      }
      return response.json({ status: 'pending', cmd })
    }
    if (await this.exists(resultPath)) {
      try {
        const raw = await fs.readFile(resultPath, 'utf8')
        const parsed = this.parseResult(raw)
        return response.json({ status: 'completed', cmd, ...parsed })
      } catch (err) {
        logger.error({ err, cmd }, '[HostCommands] failed to read result file')
        return response.status(500).json({ error: 'Could not read result file' })
      }
    }
    return response.json({ status: 'idle', cmd })
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  /**
   * Parse the LaunchAgent's result file format:
   *   cmd=<name>
   *   exit_code=<n>
   *   duration_seconds=<n>
   *   finished_at=<epoch>
   *   output<<END_OF_OUTPUT
   *   ... multi-line ...
   *   END_OF_OUTPUT
   */
  private parseResult(raw: string): {
    exit_code: number
    duration_seconds: number
    finished_at: number
    output: string
  } {
    let exit_code = 0
    let duration_seconds = 0
    let finished_at = 0
    let output = ''

    const lines = raw.split('\n')
    let inOutput = false
    const outputLines: string[] = []
    for (const line of lines) {
      if (inOutput) {
        if (line === 'END_OF_OUTPUT') {
          inOutput = false
          continue
        }
        outputLines.push(line)
        continue
      }
      if (line.startsWith('exit_code=')) exit_code = parseInt(line.slice('exit_code='.length), 10) || 0
      else if (line.startsWith('duration_seconds=')) duration_seconds = parseInt(line.slice('duration_seconds='.length), 10) || 0
      else if (line.startsWith('finished_at=')) finished_at = parseInt(line.slice('finished_at='.length), 10) || 0
      else if (line.startsWith('output<<END_OF_OUTPUT')) inOutput = true
    }
    output = outputLines.join('\n').trim()
    return { exit_code, duration_seconds, finished_at, output }
  }
}
