import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Alert from '~/components/Alert'
import HostCommandButton from '~/components/HostCommandButton'
import api from '~/lib/api'

const DISMISS_KEY_PREFIX = 'nomad:candidate-drive-dismissed:'

/**
 * Shows an "Adopt this drive?" banner when the host has detected a non-active
 * project-nomad data drive plugged into this Mac. Polls
 * GET /api/system/candidate-drive every 15s; the marker exists only while such
 * a drive is available, so "available" ⟺ "a drive is ready to adopt".
 *
 * Adopting re-points this Mac's active library to the drive (and reconciles the
 * catalog) until the drive is ejected — at which point the Mac reverts to its
 * own internal library. The dismiss is client-side and keyed by the marker's
 * detectedAt, so a *different* drive (new timestamp) re-shows even if a prior
 * one was dismissed.
 *
 * Mounted in both AppLayout (Command Center / maps / workshop) and
 * SettingsLayout so it surfaces app-wide.
 */
export default function CandidateDriveBanner() {
  const { data } = useQuery({
    queryKey: ['system', 'candidate-drive'],
    queryFn: async () => {
      const res = await api.getCandidateDrive()
      return res ?? { available: false as const }
    },
    refetchInterval: 15000,
    initialData: { available: false as const },
  })

  // Per-drive dismiss state, keyed by detectedAt so a *different* drive (new
  // timestamp) re-shows even after a prior one was dismissed. We remember the
  // last-dismissed key (not a bare boolean) so polling in a new marker — which
  // changes the key while the component stays mounted — is not masked by stale
  // dismiss state.
  const dismissKey =
    data?.available && data.detectedAt ? `${DISMISS_KEY_PREFIX}${data.detectedAt}` : null

  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const persistedDismissed = (() => {
    if (!dismissKey) return false
    try {
      return localStorage.getItem(dismissKey) === 'true'
    } catch {
      return false
    }
  })()

  const handleDismiss = () => {
    setDismissedKey(dismissKey)
    if (!dismissKey) return
    try {
      localStorage.setItem(dismissKey, 'true')
    } catch {}
  }

  const dismissed = persistedDismissed || (dismissKey !== null && dismissedKey === dismissKey)

  if (!data?.available || dismissed) {
    return null
  }

  return (
    <div className="px-4 pt-4">
      <Alert
        type="info"
        variant="bordered"
        dismissible
        onDismiss={handleDismiss}
        title="A NOMAD drive is plugged in"
        message={`Use '${data.label}' as this Mac's library? Adopting restarts the content services and may take a minute. The drive stays this Mac's active library until it's ejected — then this Mac reverts to its own library.`}
      >
        <HostCommandButton cmd="adopt-drive" label="Adopt this drive" />
      </Alert>
    </div>
  )
}
