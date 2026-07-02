import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import FileUploader from '~/components/file-uploader'
import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import StyledTable from '~/components/StyledTable'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import { IconX } from '@tabler/icons-react'
import { useModals } from '~/context/ModalContext'
import StyledModal from '../StyledModal'
import ActiveEmbedJobs from '~/components/ActiveEmbedJobs'
import type { StoredFileInfo } from '../../../types/rag'
import type { KbIngestStateValue } from '../../../types/kb_ingest_state'

// Per-file ingest state pill (RFC #883 §5). `null` state = a Qdrant source the
// scanner hasn't recorded yet (pre-RFC data) — its chunks exist, so show Indexed.
const STATE_PILLS: Record<
  KbIngestStateValue | 'legacy',
  { label: string; className: string }
> = {
  indexed: { label: 'Indexed', className: 'bg-desert-green/10 text-desert-green' },
  legacy: { label: 'Indexed', className: 'bg-desert-green/10 text-desert-green' },
  pending_decision: { label: 'Pending', className: 'bg-desert-sand text-desert-stone-dark' },
  browse_only: { label: 'Browse only', className: 'bg-surface-secondary text-text-secondary' },
  failed: { label: 'Failed', className: 'bg-desert-red/10 text-desert-red' },
  stalled: { label: 'Stalled', className: 'bg-amber-100 text-amber-800' },
}

function StatePill({ state, chunks }: { state: KbIngestStateValue | null; chunks: number }) {
  const pill = STATE_PILLS[state ?? 'legacy']
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${pill.className}`}
      title={chunks > 0 ? `${chunks.toLocaleString()} chunks embedded` : undefined}
    >
      {pill.label}
    </span>
  )
}

interface KnowledgeBaseModalProps {
  aiAssistantName?: string
  onClose: () => void
}

function sourceToDisplayName(source: string): string {
  const parts = source.split(/[/\\]/)
  return parts[parts.length - 1]
}

export default function KnowledgeBaseModal({ aiAssistantName = "AI Assistant", onClose }: KnowledgeBaseModalProps) {
  const { addNotification } = useNotifications()
  const [files, setFiles] = useState<File[]>([])
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<string | null>(null)
  const fileUploaderRef = useRef<React.ComponentRef<typeof FileUploader>>(null)
  const { openModal, closeModal } = useModals()
  const queryClient = useQueryClient()

  const { data: storedFiles = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['storedFiles'],
    queryFn: () => api.getStoredRAGFiles(),
    select: (data) => data || [],
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadDocument(file),
    onSuccess: (data) => {
      addNotification({
        type: 'success',
        message: data?.message || 'Document uploaded and queued for processing',
      })
      setFiles([])
      if (fileUploaderRef.current) {
        fileUploaderRef.current.clear()
      }
    },
    onError: (error: any) => {
      addNotification({
        type: 'error',
        message: error?.message || 'Failed to upload document',
      })
    },
  })

  // Global ingest policy (RFC #883 §1/§4): Always = auto-index new files on
  // scan; Manual = record them as Pending and wait for a per-file Index click.
  const { data: policySetting } = useQuery({
    queryKey: ['setting', 'rag.defaultIngestPolicy'],
    queryFn: () => api.getSetting('rag.defaultIngestPolicy'),
  })
  const policy: 'Always' | 'Manual' = policySetting?.value === 'Manual' ? 'Manual' : 'Always'
  const policyMutation = useMutation({
    mutationFn: (next: 'Always' | 'Manual') => api.updateSetting('rag.defaultIngestPolicy', next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'rag.defaultIngestPolicy'] })
    },
    onError: () => {
      addNotification({ type: 'error', message: 'Failed to update the indexing policy.' })
    },
  })

  const embedMutation = useMutation({
    mutationFn: (source: string) => api.embedRAGFile(source),
    onSuccess: (data) => {
      addNotification({ type: 'success', message: data?.message || 'Indexing queued.' })
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to queue indexing.' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (source: string) => api.deleteRAGFile(source),
    onSuccess: () => {
      addNotification({ type: 'success', message: 'File removed from knowledge base.' })
      setConfirmDeleteSource(null)
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to delete file.' })
      setConfirmDeleteSource(null)
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => api.syncRAGStorage(),
    onSuccess: (data) => {
      addNotification({
        type: 'success',
        message: data?.message || 'Storage synced successfully. If new files were found, they have been queued for processing.',
      })
    },
    onError: (error: any) => {
      addNotification({
        type: 'error',
        message: error?.message || 'Failed to sync storage',
      })
    },
  })

  const handleUpload = () => {
    if (files.length > 0) {
      uploadMutation.mutate(files[0])
    }
  }

  const handleConfirmSync = () => {
    openModal(
      <StyledModal
        title='Confirm Sync?'
        onConfirm={() => {
          syncMutation.mutate()
          closeModal(
            "confirm-sync-modal"
          )
        }}
        onCancel={() => closeModal("confirm-sync-modal")}
        open={true}
        confirmText='Confirm Sync'
        cancelText='Cancel'
        confirmVariant='primary'
      >
        <p className='text-text-primary'>
          This will scan the NOMAD's storage directories for any new files and queue them for processing. This is useful if you've manually added files to the storage or want to ensure everything is up to date.
          This may cause a temporary increase in resource usage if new files are found and being processed. Are you sure you want to proceed?
        </p>
      </StyledModal>,
      "confirm-sync-modal"
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm transition-opacity">
      <div className="bg-surface-primary rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border-subtle shrink-0">
          <h2 className="text-2xl font-semibold text-text-primary">Knowledge Base</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
          >
            <IconX className="h-6 w-6 text-text-muted" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden">
            <div className="p-6">
              <FileUploader
                ref={fileUploaderRef}
                minFiles={1}
                maxFiles={1}
                onUpload={(uploadedFiles) => {
                  setFiles(Array.from(uploadedFiles))
                }}
              />
              <div className="flex justify-center gap-4 my-6">
                <StyledButton
                  variant="primary"
                  size="lg"
                  icon="IconUpload"
                  onClick={handleUpload}
                  disabled={files.length === 0 || uploadMutation.isPending}
                  loading={uploadMutation.isPending}
                >
                  Upload
                </StyledButton>
              </div>
            </div>
            <div className="border-t bg-surface-primary p-6">
              <h3 className="text-lg font-semibold text-desert-green mb-4">
                Why upload documents to your Knowledge Base?
              </h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
                    1
                  </div>
                  <div>
                    <p className="font-medium text-desert-stone-dark">
                      {aiAssistantName} Knowledge Base Integration
                    </p>
                    <p className="text-sm text-desert-stone">
                      When you upload documents to your Knowledge Base, NOMAD processes and embeds
                      the content, making it directly accessible to {aiAssistantName}. This allows{' '}
                      {aiAssistantName} to reference your specific documents during conversations,
                      providing more accurate and personalized responses based on your uploaded
                      data.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-desert-stone-dark">
                      Enhanced Document Processing with OCR
                    </p>
                    <p className="text-sm text-desert-stone">
                      NOMAD includes built-in Optical Character Recognition (OCR) capabilities,
                      allowing it to extract text from image-based documents such as scanned PDFs or
                      photos. This means that even if your documents are not in a standard text
                      format, NOMAD can still process and embed their content for AI access.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
                    3
                  </div>
                  <div>
                    <p className="font-medium text-desert-stone-dark">
                      Information Library Integration
                    </p>
                    <p className="text-sm text-desert-stone">
                      NOMAD will automatically discover and extract any content you save to your
                      Information Library (if installed), making it instantly available to {aiAssistantName} without any extra steps.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="my-8">
            <ActiveEmbedJobs withHeader={true} />
          </div>

          <div className="my-12">
            <div className='flex items-center justify-between mb-6'>
              <StyledSectionHeader title="Stored Knowledge Base Files" className='!mb-0' />
              <div className="flex items-center gap-3">
                {/* Ingest policy (RFC #883): Always auto-indexes on scan; Manual
                    records new files as Pending until Index is clicked per file. */}
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-text-secondary">Index new files:</span>
                  <div className="inline-flex overflow-hidden rounded-md border border-border-default text-sm font-medium">
                    {(['Always', 'Manual'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => policy !== option && policyMutation.mutate(option)}
                        disabled={policyMutation.isPending}
                        className={`px-2.5 py-1 cursor-pointer transition-colors ${
                          policy === option
                            ? 'bg-desert-green text-white'
                            : 'bg-surface-primary text-text-secondary hover:bg-surface-secondary'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <StyledButton
                  variant="secondary"
                  size="md"
                  icon='IconRefresh'
                  onClick={handleConfirmSync}
                  disabled={syncMutation.isPending || uploadMutation.isPending}
                  loading={syncMutation.isPending || uploadMutation.isPending}
                >
                  Sync Storage
                </StyledButton>
              </div>
            </div>
            <StyledTable<StoredFileInfo>
              className="font-semibold"
              rowLines={true}
              columns={[
                {
                  accessor: 'source',
                  title: 'File Name',
                  render(record) {
                    return <span className="text-text-primary">{sourceToDisplayName(record.source)}</span>
                  },
                },
                {
                  accessor: 'state',
                  title: 'Status',
                  render(record) {
                    return <StatePill state={record.state} chunks={record.chunksEmbedded} />
                  },
                },
                {
                  accessor: 'source',
                  title: '',
                  render(record) {
                    const isConfirming = confirmDeleteSource === record.source
                    const isDeleting = deleteMutation.isPending && confirmDeleteSource === record.source
                    if (isConfirming) {
                      return (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-sm text-text-secondary">Remove from knowledge base?</span>
                          <StyledButton
                            variant='danger'
                            size='sm'
                            onClick={() => deleteMutation.mutate(record.source)}
                            disabled={isDeleting}
                          >
                            {isDeleting ? 'Deleting…' : 'Confirm'}
                          </StyledButton>
                          <StyledButton
                            variant='ghost'
                            size='sm'
                            onClick={() => setConfirmDeleteSource(null)}
                            disabled={isDeleting}
                          >
                            Cancel
                          </StyledButton>
                        </div>
                      )
                    }
                    // Pending (Manual mode) and failed files get a per-row Index /
                    // Retry action (RFC #883 §5) alongside Delete.
                    const canIndex = record.state === 'pending_decision' || record.state === 'failed'
                    return (
                      <div className="flex justify-end gap-2">
                        {canIndex && (
                          <StyledButton
                            variant="primary"
                            size="sm"
                            icon="IconDatabasePlus"
                            onClick={() => embedMutation.mutate(record.source)}
                            disabled={embedMutation.isPending}
                            loading={embedMutation.isPending && embedMutation.variables === record.source}
                          >
                            {record.state === 'failed' ? 'Retry' : 'Index'}
                          </StyledButton>
                        )}
                        <StyledButton
                          variant="danger"
                          size="sm"
                          icon="IconTrash"
                          onClick={() => setConfirmDeleteSource(record.source)}
                          disabled={deleteMutation.isPending}
                          loading={deleteMutation.isPending && confirmDeleteSource === record.source}
                        >Delete</StyledButton>
                      </div>
                    )
                  },
                },
              ]}
              data={storedFiles}
              loading={isLoadingFiles}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
