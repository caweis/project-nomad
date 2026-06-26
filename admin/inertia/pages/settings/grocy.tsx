import { Head } from '@inertiajs/react'
import { useState } from 'react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import StyledButton from '~/components/StyledButton'
import Input from '~/components/inputs/Input'
import Switch from '~/components/inputs/Switch'
import Alert from '~/components/Alert'
import api from '~/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useNotifications } from '~/context/NotificationContext'

type Props = {
  grocy: {
    enabled: boolean
    baseUrl: string
    hasApiKey: boolean
  }
}

type TestResult =
  | { ok: true; covered: number; total: number; totalKcal: number }
  | { ok: false; error: string }

export default function GrocySettings({ grocy }: Props) {
  const { addNotification } = useNotifications()
  const [enabled, setEnabled] = useState(grocy.enabled)
  const [baseUrl, setBaseUrl] = useState(grocy.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      await api.updateSetting('grocy.enabled', enabled)
      await api.updateSetting('grocy.baseUrl', baseUrl.trim())
      if (apiKey.trim()) {
        await api.updateSetting('grocy.apiKey', apiKey.trim())
      }
    },
    onSuccess: () => {
      setApiKey('')
      addNotification({ type: 'success', message: 'Grocy settings saved.' })
    },
    onError: () => addNotification({ type: 'error', message: 'Could not save Grocy settings.' }),
  })

  const test = useMutation({
    mutationFn: () => api.testGrocyConnection(),
    onSuccess: (result) =>
      setTestResult(result ? (result as TestResult) : { ok: false, error: 'Request failed.' }),
  })

  return (
    <SettingsLayout>
      <Head title="Grocy — Food Readiness" />
      {/* xl:pl-72 clears the fixed w-72 sidebar — every settings page needs it
          (this one was the lone holdout, so its content rendered under the rail). */}
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6 max-w-2xl space-y-6">
        <div>
          <StyledSectionHeader title="Grocy (food readiness)" />
          <p className="mt-2 text-sm text-desert-stone">
            Connect your Grocy food container so Preparedness can read pantry stock into days-of-supply.
            Grocy stays the source of truth for food; NOMAD only reads it.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-desert-green-dark">Enable Grocy food readiness</p>
            <p className="text-sm text-desert-stone">
              When off, food readiness uses your in-app inventory.
            </p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label="Enable Grocy food readiness" />
        </div>

        <Input
          name="grocyBaseUrl"
          label="Grocy base URL"
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://nomad_grocy:80"
          helpText="The Grocy container's address on the internal network. Use Test connection to confirm it."
        />

        <Input
          name="grocyApiKey"
          label={grocy.hasApiKey ? 'API key (leave blank to keep current)' : 'API key'}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={grocy.hasApiKey ? 'Saved — type to replace' : 'Paste a Grocy API key'}
          helpText="Create a key in Grocy under Manage API keys. It is stored on the server and never shown again."
        />

        <div className="flex items-center gap-3">
          <StyledButton onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </StyledButton>
          <StyledButton variant="secondary" onClick={() => test.mutate()} loading={test.isPending}>
            Test connection
          </StyledButton>
        </div>

        {testResult &&
          (testResult.ok ? (
            <Alert type="success">
              Connected. {testResult.covered} of {testResult.total} in-stock products have calorie data
              ({testResult.totalKcal.toLocaleString()} kcal on hand).
            </Alert>
          ) : (
            <Alert type="error" message={testResult.error} />
          ))}
        </main>
      </div>
    </SettingsLayout>
  )
}
