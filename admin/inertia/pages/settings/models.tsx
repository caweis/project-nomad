import { Head, router, usePage } from '@inertiajs/react'
import { useRef, useState } from 'react'
import StyledTable from '~/components/StyledTable'
import SettingsLayout from '~/layouts/SettingsLayout'
import { NomadOllamaModel } from '../../../types/ollama'
import StyledButton from '~/components/StyledButton'
import useServiceInstalledStatus from '~/hooks/useServiceInstalledStatus'
import Alert from '~/components/Alert'
import HostCommandButton from '~/components/HostCommandButton'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import { useModals } from '~/context/ModalContext'
import StyledModal from '~/components/StyledModal'
import { ModelResponse } from 'ollama'
import { SERVICE_NAMES } from '../../../constants/service_names'
import Switch from '~/components/inputs/Switch'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import { useMutation, useQuery } from '@tanstack/react-query'
import Input from '~/components/inputs/Input'
import { IconSearch, IconRefresh } from '@tabler/icons-react'
import useDebounce from '~/hooks/useDebounce'
import ActiveModelDownloads from '~/components/ActiveModelDownloads'
import { useSystemInfo } from '~/hooks/useSystemInfo'

export default function ModelsPage(props: {
  models: {
    availableModels: NomadOllamaModel[]
    installedModels: ModelResponse[]
    settings: { chatSuggestionsEnabled: boolean; aiAssistantCustomName: string }
  }
  // True when admin is configured to talk to a native (Homebrew) Ollama at
  // OLLAMA_HOST instead of managing the Docker container itself. Set by
  // settings_controller.ts from DockerService.isNativeOllama(). When true,
  // the page hides container-management buttons (Reinstall, GPU "Fix") and
  // shows a positive Metal-accelerated banner instead.
  isNativeOllama: boolean
  // Which AI backend the host CLI selected ('omlx' | 'ollama'). Both backends
  // set OLLAMA_HOST (so isNativeOllama is true for both), but only 'ollama'
  // serves chat from Ollama. On 'omlx', chat runs on Apple MLX and Ollama is
  // the embeddings-only sidecar — so the banner must be labeled accordingly and
  // must NOT offer an "Update Ollama" button (chat isn't Ollama there).
  aiBackend?: string
}) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { isInstalled } = useServiceInstalledStatus(SERVICE_NAMES.OLLAMA)
  const { addNotification } = useNotifications()
  const { openModal, closeAllModals } = useModals()
  const { debounce } = useDebounce()
  const { data: systemInfo } = useSystemInfo({})

  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('nomad:gpu-banner-dismissed') === 'true'
    } catch {
      return false
    }
  })
  const [reinstalling, setReinstalling] = useState(false)

  const handleDismissGpuBanner = () => {
    setGpuBannerDismissed(true)
    try {
      localStorage.setItem('nomad:gpu-banner-dismissed', 'true')
    } catch {}
  }

  const handleForceReinstallOllama = () => {
    openModal(
      <StyledModal
        title="Reinstall AI Assistant?"
        onConfirm={async () => {
          closeAllModals()
          setReinstalling(true)
          try {
            const response = await api.forceReinstallService('nomad_ollama')
            if (!response || !response.success) {
              throw new Error(response?.message || 'Force reinstall failed')
            }
            addNotification({
              message: `${aiAssistantName} is being reinstalled with GPU support. This page will reload shortly.`,
              type: 'success',
            })
            try { localStorage.removeItem('nomad:gpu-banner-dismissed') } catch {}
            setTimeout(() => window.location.reload(), 5000)
          } catch (error) {
            addNotification({
              message: `Failed to reinstall: ${error instanceof Error ? error.message : 'Unknown error'}`,
              type: 'error',
            })
            setReinstalling(false)
          }
        }}
        onCancel={closeAllModals}
        open={true}
        confirmText="Reinstall"
        cancelText="Cancel"
      >
        <p className="text-gray-700">
          This will recreate the {aiAssistantName} container with GPU support enabled.
          Your downloaded models will be preserved. The service will be briefly
          unavailable during reinstall.
        </p>
      </StyledModal>,
      'gpu-health-force-reinstall-modal'
    )
  }
  const [chatSuggestionsEnabled, setChatSuggestionsEnabled] = useState(
    props.models.settings.chatSuggestionsEnabled
  )
  const [aiAssistantCustomName, setAiAssistantCustomName] = useState(
    props.models.settings.aiAssistantCustomName
  )

  const [query, setQuery] = useState('')
  const [queryUI, setQueryUI] = useState('')
  const [limit, setLimit] = useState(15)

  const debouncedSetQuery = debounce((val: string) => {
    setQuery(val)
  }, 300)

  const forceRefreshRef = useRef(false)
  const [isForceRefreshing, setIsForceRefreshing] = useState(false)

  const { data: availableModelData, isFetching, refetch } = useQuery({
    queryKey: ['ollama', 'availableModels', query, limit],
    queryFn: async () => {
      const force = forceRefreshRef.current
      forceRefreshRef.current = false
      const res = await api.getAvailableModels({
        query,
        recommendedOnly: false,
        limit,
        force: force || undefined,
      })
      if (!res) {
        return {
          models: [],
          hasMore: false,
        }
      }
      return res
    },
    initialData: { models: props.models.availableModels, hasMore: false },
  })

  async function handleForceRefresh() {
    forceRefreshRef.current = true
    setIsForceRefreshing(true)
    await refetch()
    setIsForceRefreshing(false)
    addNotification({ message: 'Model list refreshed from remote.', type: 'success' })
  }

  async function handleInstallModel(modelName: string) {
    try {
      const res = await api.downloadModel(modelName)
      if (res.success) {
        addNotification({
          message: `Model download initiated for ${modelName}. It may take some time to complete.`,
          type: 'success',
        })
      }
    } catch (error) {
      console.error('Error installing model:', error)
      addNotification({
        message: `There was an error installing the model: ${modelName}. Please try again.`,
        type: 'error',
      })
    }
  }

  async function handleDeleteModel(modelName: string) {
    try {
      const res = await api.deleteModel(modelName)
      if (res.success) {
        addNotification({
          message: `Model deleted: ${modelName}.`,
          type: 'success',
        })
      }
      closeAllModals()
      router.reload()
    } catch (error) {
      console.error('Error deleting model:', error)
      addNotification({
        message: `There was an error deleting the model: ${modelName}. Please try again.`,
        type: 'error',
      })
    }
  }

  async function confirmDeleteModel(model: string) {
    openModal(
      <StyledModal
        title="Delete Model?"
        onConfirm={() => {
          handleDeleteModel(model)
        }}
        onCancel={closeAllModals}
        open={true}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="primary"
      >
        <p className="text-gray-700">
          Are you sure you want to delete this model? You will need to download it again if you want
          to use it in the future.
        </p>
      </StyledModal>,
      'confirm-delete-model-modal'
    )
  }

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean | string }) => {
      return await api.updateSetting(key, value)
    },
    onSuccess: () => {
      addNotification({
        message: 'Setting updated successfully.',
        type: 'success',
      })
    },
    onError: (error) => {
      console.error('Error updating setting:', error)
      addNotification({
        message: 'There was an error updating the setting. Please try again.',
        type: 'error',
      })
    },
  })

  return (
    <SettingsLayout>
      <Head title={`${aiAssistantName} Settings | Project N.O.M.A.D.`} />
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6">
          <h1 className="text-4xl font-semibold mb-4">{aiAssistantName}</h1>
          <p className="text-gray-500 mb-4">
            Easily manage the {aiAssistantName}'s settings and installed models. We recommend
            starting with smaller models first to see how they perform on your system before moving
            on to larger ones.
          </p>
          {/* Hide the "not installed" warning on native Ollama — admin's
              `services` row gets installed=1 set by step_configure_native_ollama
              at install time, but if some race or rollback leaves it
              installed=0 the warning would tell the user to run a Docker
              install path that wouldn't work for them. */}
          {!isInstalled && !props.isNativeOllama && (
            <Alert
              title={`${aiAssistantName}'s dependencies are not installed. Please install them to manage AI models.`}
              type="warning"
              variant="solid"
              className="!mt-6"
            />
          )}
          {/* Positive banner replaces the GPU-passthrough warnings on native
              Ollama — the macOS distro runs Ollama as a Homebrew LaunchAgent
              with direct Metal access; there's no Docker passthrough to fail.
              Both backends set OLLAMA_HOST (so isNativeOllama is true for both),
              so we split on aiBackend to label the banner accurately:
              - 'omlx': chat runs on Apple MLX (oMLX) over Metal; Ollama is the
                embeddings-only sidecar. No "Update Ollama" button — updating
                Ollama wouldn't update the chat engine, so the button would
                mislead. Engines are managed from the `nomad` CLI on the host.
              - 'ollama' (default): chat + embeddings both served by native
                Homebrew Ollama. Update path goes through host-command-bridge —
                admin posts to /api/host-commands/upgrade-ollama, the LaunchAgent
                runs `nomad upgrade ollama` on the host. */}
          {props.isNativeOllama && props.aiBackend === 'omlx' && (
            <Alert
              type="success"
              variant="bordered"
              title="Apple MLX (oMLX) — Metal-accelerated"
              message={`${aiAssistantName} runs on Apple's MLX engine (oMLX) using the GPU directly (Metal). Embeddings are served by a local Ollama sidecar. Manage the AI engines from the \`nomad\` CLI on the host (\`nomad upgrade\`, \`nomad backend\`).`}
              className="!mt-6"
            />
          )}
          {props.isNativeOllama && props.aiBackend !== 'omlx' && (
            <Alert
              type="success"
              variant="bordered"
              title="Native Ollama — Metal-accelerated"
              message={`${aiAssistantName} is running natively on this Mac's Homebrew Ollama and using Apple Silicon's GPU directly (Metal). Update via the button below — it runs \`nomad upgrade ollama\` on the host.`}
              className="!mt-6"
            >
              <HostCommandButton cmd="upgrade-ollama" label="Update Ollama" />
            </Alert>
          )}
          {/* GPU-passthrough-failed banner only makes sense on container
              Ollama. Native installs always pass through to Metal — the
              status can't be 'passthrough_failed' there. Gate explicitly
              instead of relying on the status field. */}
          {isInstalled && !props.isNativeOllama && systemInfo?.gpuHealth?.status === 'passthrough_failed' && !gpuBannerDismissed && (
            <Alert
              type="warning"
              variant="bordered"
              title="GPU Not Accessible"
              message={`Your system has an NVIDIA GPU, but ${aiAssistantName} can't access it. AI is running on CPU only, which is significantly slower.`}
              className="!mt-6"
              dismissible={true}
              onDismiss={handleDismissGpuBanner}
              buttonProps={{
                children: `Fix: Reinstall ${aiAssistantName}`,
                icon: 'IconRefresh',
                variant: 'action',
                size: 'sm',
                onClick: handleForceReinstallOllama,
                loading: reinstalling,
                disabled: reinstalling,
              }}
            />
          )}

          <StyledSectionHeader title="Settings" className="mt-8 mb-4" />
          <div className="bg-white rounded-lg border-2 border-gray-200 p-6">
            <div className="space-y-4">
              <Switch
                checked={chatSuggestionsEnabled}
                onChange={(newVal) => {
                  setChatSuggestionsEnabled(newVal)
                  updateSettingMutation.mutate({ key: 'chat.suggestionsEnabled', value: newVal })
                }}
                label="Chat Suggestions"
                description="Display AI-generated conversation starters in the chat interface"
              />
              <Input
                name="aiAssistantCustomName"
                label="Assistant Name"
                helpText='Give your AI assistant a custom name that will be used in the chat interface and other areas of the application.'
                placeholder="AI Assistant"
                value={aiAssistantCustomName}
                onChange={(e) => setAiAssistantCustomName(e.target.value)}
                onBlur={() =>
                  updateSettingMutation.mutate({
                    key: 'ai.assistantCustomName',
                    value: aiAssistantCustomName,
                  })
                }
              />
            </div>
          </div>
          <ActiveModelDownloads withHeader />

          <StyledSectionHeader title="Models" className="mt-12 mb-4" />
          <div className="flex justify-start items-center gap-3 mt-4">
            <Input
              name="search"
              label=""
              placeholder="Search language models.."
              value={queryUI}
              onChange={(e) => {
                setQueryUI(e.target.value)
                debouncedSetQuery(e.target.value)
              }}
              className="w-1/3"
              leftIcon={<IconSearch className="w-5 h-5 text-gray-400" />}
            />
            <StyledButton
              variant="secondary"
              onClick={handleForceRefresh}
              icon="IconRefresh"
              loading={isForceRefreshing}
              className='mt-1'
            >
              Refresh Models
            </StyledButton>
          </div>
          <StyledTable<NomadOllamaModel>
            className="font-semibold mt-4"
            rowLines={true}
            columns={[
              {
                accessor: 'name',
                title: 'Name',
                render(record) {
                  // oMLX: a model with no curated mlx-community build can't be
                  // pulled by the proxy — flag it here and disable its installs.
                  const mlxUnavailable = props.aiBackend === 'omlx' && !record.mlxPullName
                  return (
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-semibold">{record.name}</p>
                        {mlxUnavailable && (
                          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                            Not available as MLX yet
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{record.description}</p>
                    </div>
                  )
                },
              },
              {
                accessor: 'estimated_pulls',
                title: 'Estimated Pulls',
              },
              {
                accessor: 'model_last_updated',
                title: 'Last Updated',
              },
            ]}
            data={availableModelData?.models || []}
            loading={isFetching}
            expandable={{
              expandedRowRender: (record) => {
                const isOmlx = props.aiBackend === 'omlx'
                const mlxUnavailable = isOmlx && !record.mlxPullName
                return (
                <div className="pl-14">
                  {isOmlx && (
                    <p className="mb-2 text-sm text-gray-500">
                      {mlxUnavailable
                        ? 'Not available as MLX yet — this model has no Apple-MLX build in the catalog.'
                        : `Installs the MLX-optimized build: ${record.mlxPullName}`}
                    </p>
                  )}
                  <div className="bg-white overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Tag
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Input Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Context Size
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Model Size
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {record.tags.map((tag, tagIndex) => {
                          const isInstalled = props.models.installedModels.some(
                            (mod) => mod.name === tag.name
                          )
                          return (
                            <tr key={tagIndex} className="hover:bg-slate-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm font-medium text-gray-900">
                                  {tag.name}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-600">{tag.input || 'N/A'}</span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-600">
                                  {tag.context || 'N/A'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-600">{tag.size || 'N/A'}</span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <StyledButton
                                  variant={isInstalled ? 'danger' : 'primary'}
                                  disabled={!isInstalled && mlxUnavailable}
                                  onClick={() => {
                                    if (isInstalled) {
                                      confirmDeleteModel(tag.name)
                                    } else if (!mlxUnavailable) {
                                      // oMLX: send the curated MLX key (mlxPullName),
                                      // not the catalog tag, so the proxy resolves it.
                                      handleInstallModel(isOmlx ? (record.mlxPullName ?? tag.name) : tag.name)
                                    }
                                  }}
                                  icon={isInstalled ? 'IconTrash' : 'IconDownload'}
                                >
                                  {isInstalled ? 'Delete' : mlxUnavailable ? 'Not in MLX' : 'Install'}
                                </StyledButton>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                )
              },
            }}
          />
          <div className="flex justify-center mt-6">
            {availableModelData?.hasMore && (
              <StyledButton
                variant="primary"
                onClick={() => {
                  setLimit((prev) => prev + 15)
                }}
              >
                Load More
              </StyledButton>
            )}
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
