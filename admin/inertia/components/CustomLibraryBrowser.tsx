import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconChevronRight, IconFileDownload, IconFolder, IconTrash } from '@tabler/icons-react'
import api from '~/lib/api'
import { formatBytes } from '~/lib/util'
import { useNotifications } from '~/context/NotificationContext'
import Alert from '~/components/Alert'
import Input from '~/components/inputs/Input'
import StyledButton from '~/components/StyledButton'
import StyledModal from '~/components/StyledModal'
import type { CustomLibraryListing } from '../../types/zim'

const SOURCES_KEY = ['custom-libraries']
type LibraryFile = CustomLibraryListing['files'][number]

function pathCrumbs(path: string): { name: string; path: string }[] {
  const segments = path.split('/').filter(Boolean)
  return segments.map((segment, index) => {
    let name = segment
    try {
      name = decodeURIComponent(segment)
    } catch {
      // Keep the encoded path visible if a source uses malformed escapes.
    }
    return { name, path: segments.slice(0, index + 1).join('/') + '/' }
  })
}

export default function CustomLibraryBrowser({
  selectedSourceId,
  onSelectSource,
  onDownload,
}: {
  selectedSourceId: number | null
  onSelectSource: (id: number | null) => void
  onDownload: (file: LibraryFile) => void
}) {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()
  const [path, setPath] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const { data: sources, isError: sourcesError } = useQuery({
    queryKey: SOURCES_KEY,
    queryFn: () => api.listCustomLibraries(),
    refetchOnWindowFocus: false,
  })
  const selected = sources?.find((source) => source.id === selectedSourceId)
  useEffect(() => {
    if (sources && selectedSourceId !== null && !selected) onSelectSource(null)
  }, [sources, selectedSourceId, selected, onSelectSource])
  useEffect(() => setPath(''), [selectedSourceId])

  const {
    data: listing,
    isLoading: isBrowsing,
    isError: browseError,
  } = useQuery({
    queryKey: ['custom-library-browse', selectedSourceId, path],
    queryFn: () => api.browseCustomLibrary(selectedSourceId!, path),
    enabled: selectedSourceId !== null && !!selected,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const addSource = useMutation({
    mutationFn: () => api.addCustomLibrary(newName.trim(), newUrl.trim()),
    onSuccess: (source) => {
      queryClient.setQueryData(SOURCES_KEY, (current: typeof sources) => [
        ...(current ?? []),
        source,
      ])
      queryClient.invalidateQueries({ queryKey: SOURCES_KEY })
      setNewName('')
      setNewUrl('')
      onSelectSource(source.id)
      setManageOpen(false)
      addNotification({ message: 'Library source added.', type: 'success' })
    },
    onError: () =>
      addNotification({
        message: 'Could not add this library source. Check its URL and the source limit.',
        type: 'error',
      }),
  })
  const removeSource = useMutation({
    mutationFn: (id: number) => api.removeCustomLibrary(id),
    onSuccess: (_, id) => {
      if (selectedSourceId === id) onSelectSource(null)
      queryClient.setQueryData(
        SOURCES_KEY,
        (current: typeof sources) => current?.filter((source) => source.id !== id) ?? []
      )
      queryClient.invalidateQueries({ queryKey: SOURCES_KEY })
      addNotification({ message: 'Library source removed.', type: 'success' })
    },
    onError: () =>
      addNotification({ message: 'Could not remove this library source.', type: 'error' }),
  })

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="zim-library-source" className="text-sm font-medium text-text-secondary">
          Source
        </label>
        <select
          id="zim-library-source"
          value={selectedSourceId === null ? 'default' : String(selectedSourceId)}
          onChange={(event) => {
            const value = event.target.value
            onSelectSource(value === 'default' ? null : Number(value))
          }}
          className="rounded-md border border-border-default bg-surface-primary px-3 py-2 text-sm text-text-primary"
        >
          <option value="default">Default Kiwix catalog</option>
          {sources?.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
        <StyledButton icon="IconLibrary" variant="outline" onClick={() => setManageOpen(true)}>
          Manage sources
        </StyledButton>
      </div>

      {sourcesError && (
        <Alert
          title="Library sources are unavailable"
          message="Try again when the database is available."
          type="error"
          variant="solid"
        />
      )}

      {selectedSourceId !== null && selected && (
        <div className="mt-5">
          <nav
            aria-label="Library folders"
            className="mb-4 flex flex-wrap items-center gap-1 text-sm"
          >
            <button className="text-desert-green hover:underline" onClick={() => setPath('')}>
              {selected.name}
            </button>
            {pathCrumbs(path).map((crumb) => (
              <span key={crumb.path} className="flex items-center gap-1">
                <IconChevronRight className="h-4 w-4 text-text-muted" />
                <button
                  className="text-desert-green hover:underline"
                  onClick={() => setPath(crumb.path)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
          {isBrowsing && (
            <p className="py-8 text-center text-text-muted">Loading this directory…</p>
          )}
          {browseError && (
            <Alert
              title="Could not browse this source"
              message="The mirror may be offline or may not offer a directory listing."
              type="error"
              variant="solid"
            />
          )}
          {!isBrowsing && listing && (
            <div className="max-h-[600px] overflow-auto rounded-lg border border-border-subtle bg-surface-primary">
              {listing.directories.length === 0 && listing.files.length === 0 ? (
                <p className="p-6 text-center text-text-muted">
                  No folders or ZIM files found here.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-secondary">
                    <tr className="border-b border-border-subtle">
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-right">Size</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listing.directories.map((dir) => (
                      <tr key={dir.path} className="border-b border-border-subtle">
                        <td className="px-4 py-3">
                          <button
                            className="flex items-center gap-2 text-desert-green hover:underline"
                            onClick={() => setPath(dir.path)}
                          >
                            <IconFolder className="h-5 w-5" />
                            {dir.name}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right text-text-muted">—</td>
                        <td />
                      </tr>
                    ))}
                    {listing.files.map((file) => (
                      <tr key={file.url} className="border-b border-border-subtle">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <IconFileDownload className="h-5 w-5 text-desert-green" />
                            {file.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-text-muted">
                          {file.size_bytes === null ? '—' : formatBytes(file.size_bytes)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <StyledButton
                            icon="IconDownload"
                            size="sm"
                            onClick={() => onDownload(file)}
                          >
                            Download
                          </StyledButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      <StyledModal
        title="Manage library sources"
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onCancel={() => setManageOpen(false)}
        cancelText="Close"
      >
        <div className="space-y-4 text-left">
          <p className="text-sm text-text-muted">
            Add a Kiwix mirror or a ZIM directory on your network.
          </p>
          {sources?.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between gap-3 rounded border border-border-subtle p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {source.name}
                  {source.is_default ? ' (built in)' : ''}
                </p>
                <p className="truncate text-xs text-text-muted">{source.base_url}</p>
              </div>
              {!source.is_default && (
                <button
                  aria-label={`Remove ${source.name}`}
                  title="Remove source"
                  disabled={removeSource.isPending}
                  onClick={() => removeSource.mutate(source.id)}
                  className="rounded p-2 text-text-muted hover:text-red-500"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <Input
            name="library-name"
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            name="library-url"
            label="Directory URL"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
          <StyledButton
            icon="IconPlus"
            disabled={!newName.trim() || !newUrl.trim() || addSource.isPending}
            loading={addSource.isPending}
            onClick={() => addSource.mutate()}
          >
            Add source
          </StyledButton>
        </div>
      </StyledModal>
    </div>
  )
}
