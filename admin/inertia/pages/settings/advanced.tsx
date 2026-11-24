import { Head } from '@inertiajs/react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import Input from '~/components/inputs/Input'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import { validateSettingValue } from '../../../app/utils/setting_value'

export default function AdvancedPage({ advanced }: { advanced: { serviceLogsUrl: string } }) {
  const { addNotification } = useNotifications()
  const queryClient = useQueryClient()
  const [serviceLogsUrl, setServiceLogsUrl] = useState(advanced.serviceLogsUrl ?? '')
  const [error, setError] = useState<string | null>(null)

  const updateServiceLogsUrl = useMutation({
    mutationFn: async (value: string) => {
      const result = await api.updateSetting('ui.serviceLogsUrl', value)
      // The shared API wrapper returns undefined when a request fails.
      if (!result?.success) throw new Error('Could not save the Service Logs URL. Try again.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-setting', 'ui.serviceLogsUrl'] })
      addNotification({ message: 'Service Logs URL saved.', type: 'success' })
    },
    onError: (cause: Error) => {
      setError(cause.message)
      addNotification({ message: cause.message, type: 'error' })
    },
  })

  function save() {
    const value = serviceLogsUrl.trim()
    const message = validateSettingValue('ui.serviceLogsUrl', value)
    setError(message)
    if (!message) updateServiceLogsUrl.mutate(value)
  }

  return (
    <SettingsLayout>
      <Head title="Advanced Settings | Project NOMAD" />
      <div className="xl:pl-72 w-full">
        <main className="px-6 py-6 sm:px-12 max-w-3xl">
          <h1 className="text-4xl font-semibold mb-4">Advanced</h1>
          <StyledSectionHeader title="Reverse proxy" className="mt-8 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
            <p className="text-sm text-text-secondary mb-4">
              If you reach NOMAD through a reverse proxy or a local DNS name, enter the address of
              Service Logs &amp; Metrics here. Leave blank to use port 9999 on this server.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1 min-w-0">
                <Input
                  name="serviceLogsUrl"
                  label="Service Logs & Metrics URL"
                  helpText="Use an HTTP or HTTPS address, or a local hostname."
                  placeholder="https://logs.example.com"
                  value={serviceLogsUrl}
                  disabled={updateServiceLogsUrl.isPending}
                  error={Boolean(error)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'serviceLogsUrlError' : undefined}
                  onChange={(event) => {
                    setServiceLogsUrl(event.target.value)
                    setError(null)
                  }}
                />
                {error && (
                  <p id="serviceLogsUrlError" role="alert" className="text-sm text-red-600 mt-1">
                    {error}
                  </p>
                )}
              </div>
              <StyledButton
                variant="primary"
                onClick={save}
                loading={updateServiceLogsUrl.isPending}
                disabled={updateServiceLogsUrl.isPending}
              >
                Save
              </StyledButton>
            </div>
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
