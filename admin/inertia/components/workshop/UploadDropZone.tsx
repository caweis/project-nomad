import { useCallback, useRef, useState } from 'react'
import {
  IconUpload,
  IconCheck,
  IconAlertCircle,
  IconX,
  IconFileUpload,
} from '@tabler/icons-react'
import type { StlCategory } from '../../../types/stl_library'

const MAX_FILE_BYTES = 200 * 1024 * 1024 // 200 MB per the upload spec
const ACCEPT_EXTS = [
  '.stl', '.3mf',
  '.step', '.stp', '.dxf', '.dwg', '.f3d', '.scad',
  '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
]

interface CategoryOption {
  value: StlCategory
  label: string
}

interface Props {
  categories: CategoryOption[]
  onComplete: () => void
}

type QueueItem = {
  id: number
  file: File
  state: 'pending' | 'uploading' | 'success' | 'rejected' | 'error'
  progress?: number
  reason?: string
  savedAs?: string
}

let nextQueueId = 0

/**
 * Drag-and-drop STL/3MF uploader for the Workshop. Render only when the
 * server has confirmed the request originated on the local network
 * (`upload_permitted: true` in the page's Inertia props).
 *
 * Uploads serially via XMLHttpRequest so we get real progress events from
 * the upload stream — the fetch API does not yet expose upload progress.
 *
 * Client-side checks (extension, size) are run before sending so the user
 * gets immediate feedback for obvious mistakes (no 200MB round-trip just to
 * be told the limit). The server enforces the same checks for security.
 */
export default function UploadDropZone({ categories, onComplete }: Props) {
  const [category, setCategory] = useState<StlCategory>(() => {
    if (typeof window === 'undefined') return 'other'
    const saved = window.localStorage.getItem('workshop.uploadCategory')
    if (saved && categories.some((c) => c.value === saved)) {
      return saved as StlCategory
    }
    return 'other'
  })
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCategoryChange = (value: StlCategory) => {
    setCategory(value)
    try {
      window.localStorage.setItem('workshop.uploadCategory', value)
    } catch {
      // localStorage unavailable (private mode, quota) — silent fall-through;
      // category just won't persist across reloads.
    }
  }

  const updateItem = useCallback((id: number, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }, [])

  const uploadOne = useCallback(
    (item: QueueItem): Promise<void> =>
      new Promise((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/workshop/upload')

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            updateItem(item.id, { progress: (e.loaded / e.total) * 100 })
          }
        })

        xhr.addEventListener('load', () => {
          try {
            const body = xhr.responseText ? JSON.parse(xhr.responseText) : {}
            if (xhr.status >= 200 && xhr.status < 300) {
              const uploaded = body.uploaded?.[0]
              const serverRejected = body.rejected?.[0]
              if (uploaded) {
                updateItem(item.id, { state: 'success', savedAs: uploaded.filename })
              } else if (serverRejected) {
                updateItem(item.id, { state: 'rejected', reason: serverRejected.reason })
              } else {
                updateItem(item.id, {
                  state: 'error',
                  reason: 'Server returned no upload result.',
                })
              }
            } else if (xhr.status === 403) {
              updateItem(item.id, {
                state: 'rejected',
                reason:
                  body.error ?? 'Upload not permitted from this network.',
              })
            } else if (xhr.status === 413) {
              updateItem(item.id, {
                state: 'rejected',
                reason: 'File exceeds 200MB limit.',
              })
            } else if (xhr.status === 503) {
              updateItem(item.id, {
                state: 'error',
                reason: body.error ?? 'Data drive disconnected — reconnect and try again.',
              })
            } else {
              updateItem(item.id, {
                state: 'error',
                reason: body.error ?? `Upload failed (HTTP ${xhr.status})`,
              })
            }
          } catch {
            updateItem(item.id, { state: 'error', reason: 'Bad server response.' })
          }
          resolve()
        })

        xhr.addEventListener('error', () => {
          updateItem(item.id, { state: 'error', reason: 'Network error during upload.' })
          resolve()
        })
        xhr.addEventListener('abort', () => {
          updateItem(item.id, { state: 'error', reason: 'Upload aborted.' })
          resolve()
        })

        const form = new FormData()
        form.append('category', category)
        form.append('files', item.file, item.file.name)
        xhr.send(form)
      }),
    [category, updateItem]
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const newItems: QueueItem[] = files.map((file) => {
        const id = ++nextQueueId
        const dot = file.name.lastIndexOf('.')
        const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
        if (!ACCEPT_EXTS.includes(ext)) {
          return {
            id,
            file,
            state: 'rejected',
            reason: `File type not accepted (${ext || 'no extension'}). Supported: STL, 3MF, STEP/STP/DXF/DWG/F3D/SCAD, PDF, PNG/JPG/WEBP/GIF.`,
          }
        }
        if (file.size > MAX_FILE_BYTES) {
          return { id, file, state: 'rejected', reason: 'File exceeds 200MB limit.' }
        }
        return { id, file, state: 'pending' }
      })

      setQueue((prev) => [...prev, ...newItems])

      const toUpload = newItems.filter((i) => i.state === 'pending')
      if (toUpload.length === 0) return

      setIsUploading(true)
      for (const item of toUpload) {
        updateItem(item.id, { state: 'uploading', progress: 0 })
        await uploadOne(item)
      }
      setIsUploading(false)
      onComplete()
    },
    [uploadOne, updateItem, onComplete]
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    void handleFiles(files)
  }

  const onSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    void handleFiles(files)
    // Reset so re-selecting the same file triggers the change event again.
    e.target.value = ''
  }

  const dismissItem = (id: number) => {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  const clearCompleted = () => {
    setQueue((prev) => prev.filter((q) => q.state === 'pending' || q.state === 'uploading'))
  }

  return (
    <section className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
        <label htmlFor="upload-category" className="text-sm font-medium text-text-secondary">
          Save uploads to category:
        </label>
        <select
          id="upload-category"
          value={category}
          onChange={(e) => handleCategoryChange(e.target.value as StlCategory)}
          disabled={isUploading}
          className="rounded border border-border-default bg-surface-primary px-2 py-1 text-sm focus:border-desert-green focus:outline-none focus:ring-1 focus:ring-desert-green disabled:opacity-50"
        >
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={[
          'rounded-lg border-2 border-dashed p-8 text-center cursor-pointer',
          'transition-colors duration-150',
          isDragOver
            ? 'border-desert-green bg-desert-green-light/20'
            : 'border-border-default bg-surface-secondary hover:border-desert-green hover:bg-desert-green-light/10',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".stl,.3mf,.step,.stp,.dxf,.dwg,.f3d,.scad,.pdf,.png,.jpg,.jpeg,.webp,.gif"
          onChange={onSelectFiles}
          className="hidden"
        />
        <IconUpload size={36} className="mx-auto text-desert-green mb-2" aria-hidden="true" />
        <p className="font-medium text-text-primary mb-1">
          Drag files here, or click to select
        </p>
        <p className="text-xs text-text-muted">
          STL · 3MF · CAD (STEP/DXF/DWG/F3D/SCAD) · PDF · images · up to 200 MB · saved to{' '}
          <code className="bg-surface-primary px-1 rounded border border-border-subtle">
            storage/stl-library/{category}/
          </code>
        </p>
      </div>

      {queue.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">
              {queue.filter((q) => q.state === 'success').length} of {queue.length} uploaded
            </p>
            {!isUploading && queue.some((q) => q.state !== 'pending' && q.state !== 'uploading') && (
              <button
                type="button"
                onClick={clearCompleted}
                className="text-xs text-text-muted hover:text-text-primary underline"
              >
                Clear finished
              </button>
            )}
          </div>
          <ul className="rounded border border-border-subtle bg-surface-primary divide-y divide-border-subtle">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} onDismiss={() => dismissItem(item.id)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function QueueRow({ item, onDismiss }: { item: QueueItem; onDismiss: () => void }) {
  const sizeMb = (item.file.size / 1024 / 1024).toFixed(1)
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <StatusIcon state={item.state} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text-primary" title={item.file.name}>
            {item.savedAs ?? item.file.name}
          </span>
          <span className="text-xs text-text-muted shrink-0">{sizeMb} MB</span>
        </div>
        {item.state === 'uploading' && (
          <div className="h-1.5 mt-1 bg-border-subtle rounded overflow-hidden">
            <div
              className="h-full bg-desert-green transition-[width] duration-150"
              style={{ width: `${Math.round(item.progress ?? 0)}%` }}
            />
          </div>
        )}
        {(item.state === 'rejected' || item.state === 'error') && item.reason && (
          <p className="text-xs text-desert-red mt-0.5">{item.reason}</p>
        )}
        {item.state === 'success' && item.savedAs && item.savedAs !== item.file.name && (
          <p className="text-xs text-text-muted mt-0.5">Saved as {item.savedAs}</p>
        )}
      </div>
      {(item.state === 'rejected' || item.state === 'error' || item.state === 'success') && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-text-muted hover:text-text-primary shrink-0"
        >
          <IconX size={16} />
        </button>
      )}
    </li>
  )
}

function StatusIcon({ state }: { state: QueueItem['state'] }) {
  if (state === 'success') return <IconCheck size={18} className="text-desert-olive shrink-0" />
  if (state === 'rejected' || state === 'error')
    return <IconAlertCircle size={18} className="text-desert-red shrink-0" />
  if (state === 'uploading')
    return <IconFileUpload size={18} className="text-desert-green shrink-0 animate-pulse" />
  return <IconFileUpload size={18} className="text-text-muted shrink-0" />
}
