import { Head } from '@inertiajs/react'
import { useState } from 'react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import StyledButton from '~/components/StyledButton'
import Switch from '~/components/inputs/Switch'
import Alert from '~/components/Alert'
import api from '~/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useNotifications } from '~/context/NotificationContext'

type Props = {
  grocy: {
    enabled: boolean
    provisioned: boolean
  }
}

type TestResult =
  | { ok: true; covered: number; total: number; totalKcal: number }
  | { ok: false; error: string }

export default function GrocySettings({ grocy }: Props) {
  const { addNotification } = useNotifications()
  const [enabled, setEnabled] = useState(grocy.enabled)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Toggling auto-provisions on the server (mint key + set URL). Flip the switch
  // optimistically so it feels instant, then revert if the server says no (most
  // often: Grocy isn't installed/initialized yet).
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setGrocyEnabled(next),
    onSuccess: (res, next) => {
      if (res?.ok) {
        addNotification({
          type: 'success',
          message: next ? 'Grocy food readiness is on.' : 'Grocy food readiness is off.',
        })
      } else {
        setEnabled((v) => !v)
        addNotification({ type: 'error', message: res?.error || 'Could not turn that on.' })
      }
    },
    onError: () => {
      setEnabled((v) => !v)
      addNotification({ type: 'error', message: 'Could not reach the server.' })
    },
  })

  const onToggle = (next: boolean) => {
    setEnabled(next)
    setTestResult(null)
    toggle.mutate(next)
  }

  const test = useMutation({
    mutationFn: () => api.testGrocyConnection(),
    onSuccess: (result) =>
      setTestResult(result ? (result as TestResult) : { ok: false, error: 'Request failed.' }),
  })

  return (
    <SettingsLayout>
      <Head title="Grocy — Food Readiness" />
      {/* xl:pl-72 clears the fixed w-72 sidebar — every settings page needs it. */}
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6 max-w-2xl space-y-6">
          <div>
            <StyledSectionHeader title="Grocy (food readiness)" />
            <p className="mt-2 text-sm text-desert-stone">
              Let Preparedness read your Grocy pantry stock to work out days-of-supply. Grocy stays the
              source of truth for food; NOMAD only reads it. NOMAD sets up the connection for you, so
              there is nothing to paste — just turn it on.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-desert-green-dark">Enable Grocy food readiness</p>
              <p className="text-sm text-desert-stone">
                When off, food readiness uses your in-app inventory.
              </p>
            </div>
            <Switch checked={enabled} onChange={onToggle} label="Enable Grocy food readiness" />
          </div>

          {enabled && (
            <div className="flex items-center gap-3">
              <StyledButton variant="secondary" onClick={() => test.mutate()} loading={test.isPending}>
                Test connection
              </StyledButton>
            </div>
          )}

          {testResult &&
            (testResult.ok ? (
              <Alert type="success">
                Connected. {testResult.covered} of {testResult.total} in-stock products have calorie
                data ({testResult.totalKcal.toLocaleString()} kcal on hand).
              </Alert>
            ) : (
              <Alert type="error" message={testResult.error} />
            ))}
        </main>
      </div>
    </SettingsLayout>
  )
}
