import { useEffect, useState } from 'react'
import StyledButton, { StyledButtonProps } from './StyledButton'
import { DynamicIconName } from './DynamicIcon'

/**
 * Allow-listed host commands. Must stay in sync with:
 *   - admin/app/controllers/host_commands_controller.ts ALLOWED_COMMANDS
 *   - install/macos/nomad host-command-bridge.sh case statement (~line 2704)
 */
export type HostCommandName =
  | 'upgrade-ollama'
  | 'upgrade-admin'
  | 'upgrade-all'
  | 'reset-ollama'
  | 'fix-kiwix'
  | 'self-update'

export interface HostCommandButtonProps {
  cmd: HostCommandName
  label: string
  /** Override default success message. Default: `✓ Updated in {duration_seconds}s` */
  successLabel?: string
  disabled?: boolean
  icon?: DynamicIconName
  variant?: StyledButtonProps['variant']
  size?: StyledButtonProps['size']
}

/**
 * Generic button that dispatches a host-side `nomad` command via the
 * host-command-bridge LaunchAgent. POSTs to /api/host-commands/:cmd to
 * queue, then polls GET /api/host-commands/:cmd every 2s until completion
 * and shows an inline ✓/✗ status pill.
 *
 * The bridge runs whatever the LaunchAgent maps `cmd` to (see
 * install/macos/nomad). Admin's container has no access to Homebrew or the
 * host `nomad` binary directly — this is the only path to host-side state
 * changes from the UI.
 */
export default function HostCommandButton({
  cmd,
  label,
  successLabel,
  disabled,
  icon = 'IconArrowUp',
  variant = 'primary',
  size,
}: HostCommandButtonProps) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'in-progress' | 'completed' | 'bridge-not-installed'>('idle')
  const [result, setResult] = useState<{ exit_code: number; duration_seconds: number } | null>(null)
  const [bridgeHelp, setBridgeHelp] = useState<string | null>(null)

  const isBusy = status === 'pending' || status === 'in-progress'

  const onClick = async () => {
    setResult(null)
    setBridgeHelp(null)
    setStatus('pending')
    try {
      const res = await fetch(`/api/host-commands/${cmd}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server returned ${res.status}`)
      }
    } catch {
      setStatus('idle')
    }
  }

  useEffect(() => {
    if (!isBusy) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/host-commands/${cmd}`)
        if (!res.ok) return
        const body = await res.json()
        if (body.status === 'completed') {
          setResult({ exit_code: body.exit_code, duration_seconds: body.duration_seconds })
          setStatus('completed')
        } else if (body.status === 'in-progress' && status !== 'in-progress') {
          setStatus('in-progress')
        } else if (body.status === 'bridge-not-installed') {
          // The host-side LaunchAgent isn't running — clicking does nothing
          // unless the user installs it. Surface the help message inline so
          // the button doesn't spin forever.
          setBridgeHelp(body.help || 'Run `nomad install-bridge` on the host to enable this button.')
          setStatus('bridge-not-installed')
        }
      } catch {
        // transient — keep polling
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [isBusy, status, cmd])

  return (
    <div className="inline-flex items-center gap-2">
      <StyledButton
        icon={icon}
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={disabled || isBusy}
        loading={isBusy}
      >
        {label}
      </StyledButton>
      {status === 'completed' && result && result.exit_code === 0 && (
        <span className="text-xs text-emerald-700">
          {successLabel ?? `✓ Updated in ${result.duration_seconds}s`}
        </span>
      )}
      {status === 'completed' && result && result.exit_code !== 0 && (
        <span className="text-xs text-red-700">✗ Failed (exit {result.exit_code})</span>
      )}
      {status === 'bridge-not-installed' && bridgeHelp && (
        <span className="text-xs text-amber-800 max-w-md">
          ⚠ Host-command bridge not running. {bridgeHelp}
        </span>
      )}
    </div>
  )
}
