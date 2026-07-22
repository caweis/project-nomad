import { useState } from 'react'
import { usePage } from '@inertiajs/react'
import Alert from '~/components/Alert'

/**
 * Post-upgrade "what's new" highlights shown once on the dashboard. Ported from
 * upstream #1112, with this fork's content.
 *
 * `version` is the release line (major.minor) these highlights describe. The
 * banner only renders when the running build's major.minor matches, so it
 * appears after a user upgrades into the line, then can be dismissed. Dismissal
 * is remembered per-line in localStorage.
 *
 * To surface a new line's highlights: bump `version` and replace `highlights`.
 * No schema or migration needed. (This fork stays on the 0.2 line, so bump the
 * highlights in place; a future 0.3 gets its own note.)
 */
const WHATS_NEW = {
  version: '0.2',
  title: "What's new",
  highlights: [
    'Night Ops — a dark mode for the whole app; the toggle sits at the bottom of the sidebar.',
    'Offline Drug Reference — search FDA drug labels by name or by situation, fully offline.',
    'Maps — drop named pins, a scale bar, and a live coordinate readout; your view is remembered.',
    'Pick your home layout — the traditional grid or the categorized scenario decks.',
  ],
}

/** Extract the major.minor line (e.g. "0.2.751" -> "0.2"). Returns null for
 *  non-numeric versions like the dev server's "dev". */
function majorMinor(version: string | undefined | null): string | null {
  const match = (version ?? '').match(/^(\d+)\.(\d+)/)
  return match ? `${match[1]}.${match[2]}` : null
}

export default function WhatsNewBanner() {
  const { appVersion } = usePage<{ appVersion: string }>().props
  const storageKey = `nomad:whatsnew-dismissed:${WHATS_NEW.version}`

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'true'
    } catch {
      return false
    }
  })

  // Only surface highlights for the release they describe, and only until the
  // user dismisses that line.
  if (dismissed || majorMinor(appVersion) !== WHATS_NEW.version) {
    return null
  }

  const handleDismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(storageKey, 'true')
    } catch {
      // localStorage unavailable (private mode, etc.) — banner just re-shows
      // next load, which is acceptable.
    }
  }

  return (
    <div className="flex justify-center items-center p-4 w-full">
      <Alert
        title={WHATS_NEW.title}
        type="info-inverted"
        variant="solid"
        className="w-full"
        dismissible
        onDismiss={handleDismiss}
      >
        <ul className="mt-1 list-disc list-inside space-y-1 text-white text-opacity-90 text-sm leading-relaxed">
          {WHATS_NEW.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </Alert>
    </div>
  )
}
