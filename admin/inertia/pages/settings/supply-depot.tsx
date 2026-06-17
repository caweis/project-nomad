import { Head, router } from '@inertiajs/react'
import SettingsLayout from '~/layouts/SettingsLayout'
import { ServiceSlim } from '../../../types/services'
import StyledButton from '~/components/StyledButton'
import { useModals } from '~/context/ModalContext'
import StyledModal from '~/components/StyledModal'
import api from '~/lib/api'
import { useEffect, useMemo, useState } from 'react'
import InstallActivityFeed from '~/components/InstallActivityFeed'
import LoadingSpinner from '~/components/LoadingSpinner'
import useErrorNotification from '~/hooks/useErrorNotification'
import useSuccessNotification from '~/hooks/useSuccessNotification'
import useInternetStatus from '~/hooks/useInternetStatus'
import useServiceInstallationActivity from '~/hooks/useServiceInstallationActivity'
import { useTransmit } from 'react-adonis-transmit'
import { BROADCAST_CHANNELS } from '../../../constants/broadcast'
import { IconDownload } from '@tabler/icons-react'
import UpdateServiceModal from '~/components/UpdateServiceModal'
import CustomAppModal, { CustomAppInitial } from '~/components/CustomAppModal'
import SupplyDepotCard from '~/components/SupplyDepotCard'
import { groupServicesByCategory } from '~/lib/supplyDepot'

function extractTag(containerImage: string): string {
  if (!containerImage) return ''
  const parts = containerImage.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : 'latest'
}

// Additive card view of the Supply Depot catalog (issue #31). Renders the same
// service list as settings/apps.tsx, grouped into category sections, with the
// same per-app actions. The handlers below are a faithful port of apps.tsx's
// handlers — kept here (not shared via a hook) so apps.tsx is untouched; the
// shared controller helper (SettingsController.buildSupplyDepotProps) keeps the
// PROPS identical so the two surfaces can't drift.
export default function SupplyDepotPage(props: {
  system: { services: ServiceSlim[] }
  isNativeOllama: boolean
  aiBackend?: string
  aiAssistantVersion?: string
}) {
  const { openModal, closeAllModals } = useModals()
  const { showError } = useErrorNotification()
  const { showSuccess } = useSuccessNotification()
  const { isOnline } = useInternetStatus()
  const { subscribe } = useTransmit()
  const installActivity = useServiceInstallationActivity()

  const [isInstalling, setIsInstalling] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  useEffect(() => {
    if (installActivity.length === 0) return
    if (
      installActivity.some(
        (activity) => activity.type === 'completed' || activity.type === 'update-complete'
      )
    ) {
      setTimeout(() => {
        window.location.reload()
      }, 3000)
    }
  }, [installActivity])

  useEffect(() => {
    const unsubscribe = subscribe(BROADCAST_CHANNELS.SERVICE_UPDATES, () => {
      setCheckingUpdates(false)
      window.location.reload()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const groups = useMemo(
    () => groupServicesByCategory(props.system.services),
    [props.system.services]
  )

  async function handleCheckUpdates() {
    try {
      if (!isOnline) {
        showError('You must have an internet connection to check for updates.')
        return
      }
      setCheckingUpdates(true)
      const response = await api.checkServiceUpdates()
      if (!response?.success) {
        throw new Error('Failed to dispatch update check')
      }
    } catch (error) {
      console.error('Error checking for updates:', error)
      showError(`Failed to check for updates: ${error.message || 'Unknown error'}`)
      setCheckingUpdates(false)
    }
  }

  const handleInstallService = (service: ServiceSlim) => {
    openModal(
      <StyledModal
        title="Install Service?"
        onConfirm={() => {
          installService(service.service_name)
          closeAllModals()
        }}
        onCancel={closeAllModals}
        open={true}
        confirmText="Install"
        cancelText="Cancel"
        confirmVariant="primary"
        icon={<IconDownload className="h-12 w-12 text-desert-green" />}
      >
        <p className="text-gray-700">
          Are you sure you want to install {service.friendly_name || service.service_name}? This
          will start the service and make it available in your Project N.O.M.A.D. instance. It may
          take some time to complete.
        </p>
      </StyledModal>,
      'install-service-modal'
    )
  }

  async function installService(serviceName: string) {
    try {
      if (!isOnline) {
        showError('You must have an internet connection to install services.')
        return
      }
      setIsInstalling(true)
      const response = await api.installService(serviceName)
      if (!response) {
        throw new Error('An internal error occurred while trying to install the service.')
      }
      if (!response.success) {
        throw new Error(response.message)
      }
    } catch (error) {
      console.error('Error installing service:', error)
      showError(`Failed to install service: ${error.message || 'Unknown error'}`)
    } finally {
      setIsInstalling(false)
    }
  }

  async function handleAffectAction(record: ServiceSlim, action: 'start' | 'stop' | 'restart') {
    try {
      setLoading(true)
      const response = await api.affectService(record.service_name, action)
      if (!response) {
        throw new Error('An internal error occurred while trying to affect the service.')
      }
      if (!response.success) {
        throw new Error(response.message)
      }
      closeAllModals()
      const verb = action === 'restart' ? 'Restarting' : action === 'stop' ? 'Stopping' : 'Starting'
      const label = record.friendly_name || record.service_name
      showSuccess(`${verb} ${label}…`)
      router.reload({ only: ['system'] })
    } catch (error) {
      console.error(`Error affecting service ${record.service_name}:`, error)
      showError(`Failed to ${action} service: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  // Wraps a start/stop/restart in the same confirmation modal apps.tsx uses
  // before the affect call fires.
  function confirmAffect(record: ServiceSlim, action: 'start' | 'stop' | 'restart') {
    const title =
      action === 'restart' ? 'Restart Service?' : action === 'stop' ? 'Stop Service?' : 'Start Service?'
    const confirmText = action === 'restart' ? 'Restart' : action === 'stop' ? 'Stop' : 'Start'
    openModal(
      <StyledModal
        title={title}
        onConfirm={() => handleAffectAction(record, action)}
        onCancel={closeAllModals}
        open={true}
        confirmText={confirmText}
        cancelText="Cancel"
      >
        <p className="text-gray-700">
          Are you sure you want to {action} {record.service_name}?
        </p>
      </StyledModal>,
      `${record.service_name}-affect-modal`
    )
  }

  async function handleForceReinstall(record: ServiceSlim) {
    try {
      setLoading(true)
      const response = await api.forceReinstallService(record.service_name)
      if (!response) {
        throw new Error('An internal error occurred while trying to force reinstall the service.')
      }
      if (!response.success) {
        throw new Error(response.message)
      }
      closeAllModals()
      const label = record.friendly_name || record.service_name
      showSuccess(`Reinstalling ${label}…`)
      router.reload({ only: ['system'] })
    } catch (error) {
      console.error(`Error force reinstalling service ${record.service_name}:`, error)
      showError(`Failed to force reinstall service: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  function confirmForceReinstall(record: ServiceSlim) {
    openModal(
      <StyledModal
        title={'Force Reinstall?'}
        onConfirm={() => handleForceReinstall(record)}
        onCancel={closeAllModals}
        open={true}
        confirmText={'Force Reinstall'}
        cancelText="Cancel"
      >
        <p className="text-gray-700">
          Are you sure you want to force reinstall {record.service_name}? This will{' '}
          <strong>WIPE ALL DATA</strong> for this service and cannot be undone. You should only do
          this if the service is malfunctioning and other troubleshooting steps have failed.
        </p>
      </StyledModal>,
      `${record.service_name}-force-reinstall-modal`
    )
  }

  function handleUpdateService(record: ServiceSlim) {
    const currentTag = extractTag(record.container_image)
    const latestVersion = record.available_update_version!
    openModal(
      <UpdateServiceModal
        record={record}
        currentTag={currentTag}
        latestVersion={latestVersion}
        onCancel={closeAllModals}
        onUpdate={async (targetVersion: string) => {
          closeAllModals()
          try {
            setLoading(true)
            const response = await api.updateService(record.service_name, targetVersion)
            if (!response?.success) {
              throw new Error(response?.message || 'Update failed')
            }
          } catch (error) {
            console.error(`Error updating service ${record.service_name}:`, error)
            showError(`Failed to update service: ${error.message || 'Unknown error'}`)
            setLoading(false)
          }
        }}
        showError={showError}
      />,
      `${record.service_name}-update-modal`
    )
  }

  // ── Custom apps (Supply Depot "bring your own" containers) ──────────────────

  function openCustomAppModal(mode: 'create' | 'edit', initial: CustomAppInitial | null = null) {
    openModal(
      <CustomAppModal
        open={true}
        mode={mode}
        initial={initial}
        onClose={closeAllModals}
        showError={showError}
        onCreated={(serviceName) => {
          closeAllModals()
          showSuccess(mode === 'edit' ? `Saving ${serviceName}…` : `Installing ${serviceName}…`)
          setTimeout(() => window.location.reload(), 1500)
        }}
      />,
      'custom-app-modal'
    )
  }

  async function handleEditCustomApp(record: ServiceSlim) {
    try {
      setLoading(true)
      const res = await api.getCustomApp(record.service_name)
      if (!res?.success || !res.app) {
        throw new Error('Could not load this app for editing.')
      }
      openCustomAppModal('edit', res.app)
    } catch (error) {
      console.error(`Error loading custom app ${record.service_name}:`, error)
      showError(`Failed to load app: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteCustomApp(record: ServiceSlim) {
    try {
      setLoading(true)
      const res = await api.deleteCustomApp(record.service_name)
      if (!res?.success) {
        throw new Error(res?.message || 'Delete failed')
      }
      closeAllModals()
      showSuccess(`Deleted ${record.friendly_name || record.service_name}.`)
      setTimeout(() => window.location.reload(), 1000)
    } catch (error) {
      console.error(`Error deleting custom app ${record.service_name}:`, error)
      showError(`Failed to delete app: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  function confirmDeleteCustomApp(record: ServiceSlim) {
    openModal(
      <StyledModal
        title="Delete Custom App?"
        onConfirm={() => handleDeleteCustomApp(record)}
        onCancel={closeAllModals}
        open={true}
        confirmText="Delete"
        confirmVariant="danger"
        cancelText="Cancel"
      >
        <p className="text-gray-700">
          Are you sure you want to delete {record.friendly_name || record.service_name}? This stops
          and removes its container. Bind-mounted data on disk is left in place.
        </p>
      </StyledModal>,
      `${record.service_name}-delete-modal`
    )
  }

  async function handlePullLatest(record: ServiceSlim) {
    try {
      setLoading(true)
      const res = await api.updateCustomAppImage(record.service_name)
      if (!res?.success) {
        throw new Error(res?.message || 'Update failed')
      }
      showSuccess(`Pulling the latest image for ${record.friendly_name || record.service_name}…`)
      router.reload({ only: ['system'] })
    } catch (error) {
      console.error(`Error pulling latest for ${record.service_name}:`, error)
      showError(`Failed to update app: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleAutoUpdate(record: ServiceSlim, enabled: boolean) {
    try {
      const res = await api.setServiceAutoUpdate(record.service_name, enabled)
      if (!res?.success) {
        throw new Error(res?.message || 'Could not update preference')
      }
      showSuccess(
        `Auto-update ${enabled ? 'enabled' : 'disabled'} for ${record.friendly_name || record.service_name}.`
      )
      router.reload({ only: ['system'] })
    } catch (error) {
      console.error(`Error toggling auto-update for ${record.service_name}:`, error)
      showError(`Failed to update preference: ${error.message || 'Unknown error'}`)
    }
  }

  async function handleViewLogs(record: ServiceSlim) {
    try {
      setLoading(true)
      const res = await api.getServiceLogs(record.service_name)
      const logs = res?.success ? res.logs : 'No logs available.'
      openModal(
        <StyledModal
          title={`Logs — ${record.friendly_name || record.service_name}`}
          open={true}
          onCancel={closeAllModals}
          cancelText="Close"
          large
        >
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-gray-900 p-4 text-left text-xs text-gray-100 whitespace-pre-wrap">
            {logs || 'No logs available.'}
          </pre>
        </StyledModal>,
        `${record.service_name}-logs-modal`
      )
    } catch (error) {
      console.error(`Error fetching logs for ${record.service_name}:`, error)
      showError(`Failed to fetch logs: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const handlers = {
    onInstall: handleInstallService,
    onForceReinstall: confirmForceReinstall,
    onUpdate: handleUpdateService,
    onAffect: confirmAffect,
    onEditCustom: handleEditCustomApp,
    onPullLatest: handlePullLatest,
    onViewLogs: handleViewLogs,
    onDeleteCustom: confirmDeleteCustomApp,
    onToggleAutoUpdate: handleToggleAutoUpdate,
  }

  return (
    <SettingsLayout>
      <Head title="Supply Depot" />
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-semibold">Supply Depot</h1>
              <p className="text-gray-500 mt-1">
                Browse and install apps for your Project N.O.M.A.D. instance, organized by category.
                Nightly update checks automatically detect when new versions are available.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StyledButton
                icon="IconPlus"
                variant="primary"
                onClick={() => openCustomAppModal('create')}
              >
                Add Custom App
              </StyledButton>
              <StyledButton
                icon="IconRefreshAlert"
                onClick={handleCheckUpdates}
                disabled={checkingUpdates || !isOnline}
                loading={checkingUpdates}
              >
                Check for Updates
              </StyledButton>
            </div>
          </div>

          {loading && <LoadingSpinner fullscreen />}

          {!loading &&
            groups.map((group) => (
              <section key={group.category} className="mb-10">
                <h2 className="mb-4 text-xl font-semibold text-desert-green-dark border-b border-desert-tan-lighter pb-2">
                  {group.label}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.services.map((service) => (
                    <SupplyDepotCard
                      key={service.service_name}
                      record={service}
                      isNativeOllama={props.isNativeOllama}
                      aiBackend={props.aiBackend}
                      aiAssistantVersion={props.aiAssistantVersion}
                      isOnline={isOnline}
                      isInstalling={isInstalling}
                      loading={loading}
                      handlers={handlers}
                    />
                  ))}
                </div>
              </section>
            ))}

          {installActivity.length > 0 && (
            <InstallActivityFeed activity={installActivity} className="mt-8" withHeader />
          )}
        </main>
      </div>
    </SettingsLayout>
  )
}
