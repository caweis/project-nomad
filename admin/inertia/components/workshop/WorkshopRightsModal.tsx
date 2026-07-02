import { useState } from 'react'
import { Dialog, DialogPanel, DialogTitle, DialogBackdrop } from '@headlessui/react'
import { IconAlertTriangle } from '@tabler/icons-react'
import StyledButton from '~/components/StyledButton'

/**
 * One-time acceptance modal shown on first Workshop visit.
 *
 * NOMAD does not validate license/rights of the STL files a user stores.
 * Some files are CC0 / public-domain (medical printables from NIH 3D
 * Print Exchange, etc.); some are paywalled designs the user might be
 * tempted to redistribute. We don't police that — but we do require an
 * explicit acknowledgment that the user is responsible for ensuring they
 * have the right to store every file.
 *
 * Decline path: there isn't one. If the user doesn't accept, they can't
 * use Workshop. The modal just sits there. They can navigate away.
 *
 * Acceptance writes kv_store(workshop.rightsAcknowledged='true') and the
 * modal stays dismissed for all future visits on this admin instance.
 */
export default function WorkshopRightsModal({
  open,
  onAccept,
}: {
  open: boolean
  onAccept: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/workshop/acknowledge-rights', { method: 'POST' })
      if (!res.ok) throw new Error(`server returned ${res.status}`)
      onAccept()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => { /* no-close-on-backdrop — explicit accept only */ }} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="max-w-md w-full rounded-lg bg-surface-primary p-6 shadow-xl">
          <div className="flex items-start gap-3 mb-4">
            <IconAlertTriangle size={28} className="text-amber-500 shrink-0 mt-1" />
            <div>
              <DialogTitle className="text-lg font-semibold text-text-primary">
                Use at your own peril
              </DialogTitle>
              <p className="text-sm text-text-secondary mt-1">
                Before you use Workshop, you need to acknowledge how this library is intended to work.
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm text-text-secondary mb-5">
            <p>
              <strong>You are responsible</strong> for ensuring you have the right to store every STL
              you put in this library. Some 3D-printable files are public-domain or
              Creative-Commons-licensed; others are paid designs from creators who haven't given you
              permission to redistribute them.
            </p>
            <p>
              NOMAD does not police this. The library is a private catalog on your data drive — what
              you put in it is your call, and your liability.
            </p>
            <p>
              If you're unsure about a file, leave it out. The per-file <em>license</em> field
              (optional, freeform) is there if you want to record what you know about each file's
              terms — but no value is enforced.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-3">Couldn't save acknowledgment: {error}</p>
          )}

          <StyledButton variant="primary" fullWidth onClick={accept} loading={submitting}>
            I understand — let me into Workshop
          </StyledButton>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
