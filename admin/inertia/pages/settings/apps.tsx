import { Head, router } from '@inertiajs/react'
import StyledTable from '~/components/StyledTable'
import SettingsLayout from '~/layouts/SettingsLayout'
import { ServiceSlim } from '../../../types/services'
import { getServiceLink } from '~/lib/navigation'
import StyledButton from '~/components/StyledButton'
import { useModals } from '~/context/ModalContext'
import StyledModal from '~/components/StyledModal'
import api from '~/lib/api'
import { useEffect, useState } from 'react'
import InstallActivityFeed from '~/components/InstallActivityFeed'
import LoadingSpinner from '~/components/LoadingSpinner'
import useErrorNotification from '~/hooks/useErrorNotification'
import useSuccessNotification from '~/hooks/useSuccessNotification'
import useInternetStatus from '~/hooks/useInternetStatus'
import useServiceInstallationActivity from '~/hooks/useServiceInstallationActivity'
import { useTransmit } from 'react-adonis-transmit'
import { BROADCAST_CHANNELS } from '../../../constants/broadcast'
import { IconArrowUp, IconCheck, IconDownload } from '@tabler/icons-react'
import UpdateServiceModal from '~/components/UpdateServiceModal'
import HostCommandButton from '~/components/HostCommandButton'
import { SERVICE_NAMES } from '../../../constants/service_names'
import { SERVICE_CREDENTIAL_NOTES } from '../../../constants/service_credential_notes'
import CustomAppModal, { CustomAppInitial } from '~/components/CustomAppModal'
import AppManageMenu, { AppMenuItem } from '~/components/AppManageMenu'
import { isPinned } from '~/util/home_decks'

function extractTag(containerImage: string): string {
  if (!containerImage) return ''
  const parts = containerImage.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : 'latest'
}

export default function SettingsPage(props: {
  system: { services: ServiceSlim[] }
  // True when admin is configured to talk to a native (Homebrew) Ollama at
  // OLLAMA_HOST instead of the bundled Docker container. Set by
  // settings_controller.ts from DockerService.isNativeOllama(). When true,
  // the nomad_ollama service row replaces its Start/Stop/Restart/Force
  // Reinstall/Update buttons with a "Native — manage via CLI" pill.
  isNativeOllama: boolean
  // Which AI backend the host CLI selected ('omlx' | 'ollama'). Both run a
  // native (Metal) Ollama, so isNativeOllama alone can't distinguish them.
  // On 'omlx' chat is served by Apple MLX and Ollama is only the embeddings
  // sidecar, so the "AI Assistant" card must not offer an Ollama "Update"
  // (it wouldn't update the chat engine). Defaults to 'ollama' when unset.
  aiBackend?: string
  // Real version of the native Ollama daemon on the 'ollama' backend, probed
  // server-side from /api/version. The seeder's container-image tag is the
  // wrong source for the AI Assistant row (see the Version cell below), so the
  // controller supplies the live value here. Undefined on the 'omlx' backend
  // (the row shows "Apple MLX" instead) or when the daemon is unreachable.
  aiAssistantVersion?: string
  // Per-app home pin overrides (issue #44): service_name -> explicit pinned
  // state. The overflow menu reads this to show "Pin to home" vs "Unpin from
  // home" per installed app and toggles it via POST /api/home/pins. Default {}.
  pins: Record<string, boolean>
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

  // Listen for service update check completion
  useEffect(() => {
    const unsubscribe = subscribe(BROADCAST_CHANNELS.SERVICE_UPDATES, () => {
      setCheckingUpdates(false)
      window.location.reload()
    })
    return () => { unsubscribe() }
  }, [])

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

      // Surface the success immediately. The previous code closed the modal
      // and then waited 3 seconds in silence before doing a hard
      // window.location.reload() — users couldn't tell the click had any
      // effect and assumed the button was broken. Show a toast naming the
      // service + action, then soft-refresh the system prop so the row's
      // status flips to "restarting" / "stopped" / "running" without
      // reloading the entire page (which loses in-page state).
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

      // Same UX fix as handleAffectAction — toast + soft refresh instead of
      // a silent 3-second wait followed by a hard browser reload.
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
          showSuccess(
            mode === 'edit'
              ? `Saving ${serviceName}…`
              : `Installing ${serviceName}…`
          )
          // The install/recreate runs server-side; reload to pick up the new/updated row.
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

  // Pin/unpin a service to the Command Center home (issue #44). Keyed on
  // service_name (the deckKey for service rows). POSTs the override through the
  // shared endpoint, then reloads only the `pins` prop so the menu label flips.
  function handleTogglePin(record: ServiceSlim, pinned: boolean) {
    router.post(
      '/api/home/pins',
      { key: record.service_name, pinned },
      { preserveScroll: true, onSuccess: () => router.reload({ only: ['pins'] }) }
    )
  }

  const AppActions = ({ record }: { record: ServiceSlim }) => {
    // Opens the Stop/Start confirm modal for the service's current status.
    const openAffectModal = () => {
      const willStop = record.status === 'running'
      openModal(
        <StyledModal
          title={`${willStop ? 'Stop' : 'Start'} Service?`}
          onConfirm={() => handleAffectAction(record, willStop ? 'stop' : 'start')}
          onCancel={closeAllModals}
          open={true}
          confirmText={willStop ? 'Stop' : 'Start'}
          cancelText="Cancel"
        >
          <p className="text-gray-700">
            Are you sure you want to {willStop ? 'stop' : 'start'} {record.service_name}?
          </p>
        </StyledModal>,
        `${record.service_name}-affect-modal`
      )
    }

    const openRestartModal = () => {
      openModal(
        <StyledModal
          title={'Restart Service?'}
          onConfirm={() => handleAffectAction(record, 'restart')}
          onCancel={closeAllModals}
          open={true}
          confirmText={'Restart'}
          cancelText="Cancel"
        >
          <p className="text-gray-700">
            Are you sure you want to restart {record.service_name}?
          </p>
        </StyledModal>,
        `${record.service_name}-affect-modal`
      )
    }

    const openForceReinstallModal = () => {
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

    // Everything past Open (and a conditional Update) collapses into one "⋯"
    // overflow menu so a table row stays on a single line instead of wrapping
    // into a ragged stack: lifecycle (Stop/Start, Restart), then the custom-app
    // cluster (Edit / Pull latest / Logs / Auto-update), then a divider and the
    // destructive zone (Delete for custom apps, then Wipe & reinstall). Wipe keeps
    // its prior visibility (installed + known status) and sits last, isolated in red.
    const buildInstalledMenu = (): AppMenuItem[] => {
      const items: AppMenuItem[] = []
      const statusKnown = !!record.status && record.status !== 'unknown'

      if (statusKnown) {
        items.push({
          kind: 'action',
          icon: record.status === 'running' ? 'IconPlayerStop' : 'IconPlayerPlay',
          label: record.status === 'running' ? 'Stop' : 'Start',
          onClick: openAffectModal,
          disabled: isInstalling,
        })
        if (record.status === 'running') {
          items.push({
            kind: 'action',
            icon: 'IconRefresh',
            label: 'Restart',
            onClick: openRestartModal,
            disabled: isInstalling,
          })
        }
      }

      // Pin/unpin to the Command Center home (issue #44). Current state layers
      // the user's override (props.pins) over the default display_order rule via
      // the shared isPinned helper, keyed on service_name.
      const pinned = isPinned(
        { deckKey: record.service_name, displayOrder: record.display_order ?? 100 },
        props.pins
      )
      items.push({
        kind: 'action',
        icon: 'IconPin',
        label: pinned ? 'Unpin from home' : 'Pin to home',
        onClick: () => handleTogglePin(record, !pinned),
      })

      if (record.is_custom) {
        items.push(
          {
            kind: 'action',
            icon: 'IconPencil',
            label: 'Edit',
            onClick: () => handleEditCustomApp(record),
            disabled: loading,
          },
          {
            kind: 'action',
            icon: 'IconArrowUp',
            label: 'Pull latest',
            onClick: () => handlePullLatest(record),
            disabled: loading || !isOnline,
          },
          {
            kind: 'action',
            icon: 'IconFileText',
            label: 'Logs',
            onClick: () => handleViewLogs(record),
            disabled: loading,
          }
        )
      }

      // Auto-update opt-in applies to every installed app (curated + custom),
      // gated by the global master switch. It used to be pushed only for custom
      // apps, so curated apps could never opt in.
      items.push({
        kind: 'toggle',
        label: 'Auto-update',
        checked: !!record.auto_update_enabled,
        onChange: (enabled) => handleToggleAutoUpdate(record, enabled),
      })

      const destructive: AppMenuItem[] = []
      if (record.is_custom) {
        destructive.push({
          kind: 'action',
          icon: 'IconTrash',
          label: 'Delete',
          onClick: () => confirmDeleteCustomApp(record),
          disabled: loading,
          danger: true,
        })
      }
      if (statusKnown) {
        destructive.push({
          kind: 'action',
          icon: 'IconAlertTriangle',
          label: 'Wipe & reinstall',
          onClick: openForceReinstallModal,
          disabled: isInstalling,
          danger: true,
        })
      }
      if (destructive.length) {
        if (items.length) items.push({ kind: 'divider' })
        items.push(...destructive)
      }
      return items
    }

    if (!record) return null

    // Native Ollama: every Docker-side action (Start / Stop / Restart / Force
    // Reinstall / Update) routes through DockerService which refuses with a
    // "manage via CLI" error. Replace with the Native (Metal) pill plus a
    // direct-to-host Upgrade button backed by the host-command-bridge
    // LaunchAgent (admin POSTs /api/host-commands/upgrade-ollama, which
    // writes a marker file; the bridge runs `nomad upgrade ollama` and
    // writes a result file admin polls).
    //
    // Backend split: on 'omlx', chat is served by Apple MLX and this native
    // Ollama is only the embeddings sidecar — so an Ollama "Update" would NOT
    // update the chat engine and is misleading (this is the footgun the host
    // CLI used to warn about). We show the MLX engine and omit the Ollama
    // Update; the whole AI stack is updated host-side via `nomad upgrade`.
    // On 'ollama', chat IS Ollama, so the host-side Ollama upgrade is the
    // correct chat-engine update and stays. "Reset" recovers the host Ollama
    // engine on both backends (embeddings on omlx, chat on ollama).
    if (props.isNativeOllama && record.service_name === SERVICE_NAMES.OLLAMA) {
      const isMlx = props.aiBackend === 'omlx'
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
            title={
              isMlx
                ? "Chat runs on Apple MLX (Metal-accelerated). The AI stack is host-managed — update it with 'nomad upgrade' on the host. Ollama here serves only embeddings."
                : "Ollama is running natively on this Mac (Metal-accelerated). Container actions don't apply."
            }
          >
            {isMlx ? 'Apple MLX (Metal)' : 'Native (Metal)'}
          </span>
          {!isMlx && (
            <HostCommandButton cmd="upgrade-ollama" label="Update" disabled={!isOnline} />
          )}
          <HostCommandButton
            cmd="reset-ollama"
            label="Reset"
            icon="IconRefresh"
            variant="action"
            successLabel="✓ Reset complete"
          />
        </div>
      )
    }

    if (!record.installed) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <StyledButton
            icon={'IconDownload'}
            variant="primary"
            onClick={() => handleInstallService(record)}
            disabled={isInstalling || !isOnline}
            loading={isInstalling}
          >
            Install
          </StyledButton>
          <AppManageMenu
            items={[
              {
                kind: 'action',
                icon: 'IconAlertTriangle',
                label: 'Wipe & reinstall',
                onClick: openForceReinstallModal,
                disabled: isInstalling,
                danger: true,
              },
            ]}
            disabled={isInstalling}
          />
        </div>
      )
    }

    const menuItems = buildInstalledMenu()
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StyledButton
          icon={'IconExternalLink'}
          onClick={() => {
            // custom_url (a reverse-proxy / local-DNS override) wins over the default port link.
            window.open(getServiceLink(record.custom_url || record.ui_location || 'unknown'), '_blank')
          }}
        >
          Open
        </StyledButton>
        {/* Curated-app version updates (registry tag bump) stay inline so a waiting
            update is visible at a glance; custom apps update via "Pull latest" in the
            menu. available_update_version arrives as the number 0 when up to date, so
            this is a ternary that can only yield the button or null — a `&& 0 &&` chain
            would render a literal "0". */}
        {!record.is_custom && record.available_update_version ? (
          <StyledButton
            icon="IconArrowUp"
            variant="action"
            onClick={() => handleUpdateService(record)}
            disabled={isInstalling || !isOnline}
          >
            Update
          </StyledButton>
        ) : null}
        {menuItems.length > 0 && <AppManageMenu items={menuItems} disabled={isInstalling} />}
      </div>
    )
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
                Browse and install apps for your Project N.O.M.A.D. instance, organized by category. Nightly update checks automatically detect when new versions are available.
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
          {!loading && (
            <StyledTable<ServiceSlim & { actions?: any }>
              className="font-semibold !overflow-x-auto"
              rowLines={true}
              columns={[
                {
                  accessor: 'friendly_name',
                  title: 'Name',
                  render(record) {
                    return (
                      <div className="flex flex-col">
                        <p>{record.friendly_name || record.service_name}</p>
                        <p className="text-sm text-gray-500">{record.description}</p>
                        {record.installed && SERVICE_CREDENTIAL_NOTES[record.service_name] && (
                          <p className="text-xs text-desert-green-dark mt-1 font-medium">
                            {SERVICE_CREDENTIAL_NOTES[record.service_name]}
                          </p>
                        )}
                      </div>
                    )
                  },
                },
                {
                  accessor: 'category',
                  title: 'Category',
                  render: (record) =>
                    record.category ? (
                      <span className="inline-flex items-center rounded-full bg-desert-sand px-2.5 py-0.5 text-xs font-medium capitalize text-desert-stone-dark">
                        {record.category}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    ),
                },
                {
                  accessor: 'ui_location',
                  title: 'Location',
                  render: (record) => (
                    <a
                      href={getServiceLink(record.custom_url || record.ui_location || 'unknown')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-desert-green hover:underline font-semibold"
                    >
                      {record.custom_url || record.ui_location}
                    </a>
                  ),
                },
                {
                  accessor: 'installed',
                  title: 'Installed',
                  render: (record) =>
                    record.installed ? <IconCheck className="h-6 w-6 text-desert-green" /> : '',
                },
                {
                  accessor: 'container_image',
                  title: 'Version',
                  render: (record) => {
                    if (!record.installed) return null
                    // The AI Assistant version is backend-aware, mirroring the
                    // Actions cell. The seeder's container-image tag
                    // (ollama/ollama:0.15.2) is the wrong source on both native
                    // backends: on 'omlx' chat runs on Apple MLX and Ollama is
                    // only the embeddings sidecar (wrong engine), and on
                    // 'ollama' the real version is the host daemon's, supplied
                    // server-side via aiAssistantVersion. See settings_controller.ts.
                    if (props.isNativeOllama && record.service_name === SERVICE_NAMES.OLLAMA) {
                      if (props.aiBackend === 'omlx') {
                        return <span className="text-gray-600">Apple MLX</span>
                      }
                      return (
                        <span className="text-gray-600">{props.aiAssistantVersion || '—'}</span>
                      )
                    }
                    const currentTag = extractTag(record.container_image)
                    if (record.available_update_version) {
                      return (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500">{currentTag}</span>
                          <IconArrowUp className="h-4 w-4 text-desert-green" />
                          <span className="text-desert-green font-semibold">
                            {record.available_update_version}
                          </span>
                        </div>
                      )
                    }
                    return <span className="text-gray-600">{currentTag}</span>
                  },
                },
                {
                  accessor: 'actions',
                  title: 'Actions',
                  className: '!whitespace-normal',
                  render: (record) => <AppActions record={record} />,
                },
              ]}
              data={props.system.services}
            />
          )}
          {installActivity.length > 0 && (
            <InstallActivityFeed activity={installActivity} className="mt-8" withHeader />
          )}
        </main>
      </div>
    </SettingsLayout>
  )
}

