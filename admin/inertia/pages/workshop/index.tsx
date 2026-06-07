import { useMemo, useState } from 'react'
import { Head, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StlCard from '~/components/workshop/StlCard'
import WorkshopFilters from '~/components/workshop/WorkshopFilters'
import WorkshopRightsModal from '~/components/workshop/WorkshopRightsModal'
import UploadDropZone from '~/components/workshop/UploadDropZone'
import WorkshopBatchBar, { type BatchFields } from '~/components/workshop/WorkshopBatchBar'
import StyledButton from '~/components/StyledButton'
import { IconAlertTriangle, IconBox, IconNetworkOff } from '@tabler/icons-react'
import { pageList } from '../../../util/workshop_pagination'
import type {
  StlCategory,
  StlDifficulty,
  StlFileSlim,
  StlListFilters,
  StlLibraryUnavailable,
  StlMaterial,
  WorkshopFileTypeEnum,
} from '../../../types/stl_library'

type BatchAction = 'update-metadata' | 'recategorize' | 'delete'

interface Pagination {
  total: number
  per_page: number
  current_page: number
  last_page: number
}

interface PageProps {
  unavailable: StlLibraryUnavailable | null
  files: StlFileSlim[]
  pagination: Pagination | null
  filters: StlListFilters
  enums: {
    file_types: WorkshopFileTypeEnum[]
    categories: { value: StlCategory; label: string }[]
    materials: StlMaterial[]
    difficulties: StlDifficulty[]
  }
  rights_acknowledged: boolean
  upload_permitted: boolean
  upload_permitted_reason: string | null
}

export default function WorkshopIndex(props: PageProps) {
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [rightsOpen, setRightsOpen] = useState(!props.rights_acknowledged)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const pageIds = useMemo(() => props.files.map((f) => f.id), [props.files])
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllOnPage = () => {
    setSelected((prev) => {
      // If everything on the page is already selected, this acts as "deselect
      // the page"; otherwise add every id on the page to the selection.
      const next = new Set(prev)
      if (pageIds.every((id) => next.has(id))) {
        pageIds.forEach((id) => next.delete(id))
      } else {
        pageIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  // Run a batch op against /api/workshop/batch. Returns an error string on
  // failure (the bar shows it inline and keeps the selection for retry) or
  // null on success — on which we clear the selection and reload the grid so
  // pagination + counts reflect the change.
  const runBatch = async (action: BatchAction, fields: BatchFields): Promise<string | null> => {
    const ids = [...selected]
    if (ids.length === 0) return 'No files selected.'
    try {
      const res = await fetch('/api/workshop/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ action, ids, ...fields }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return body.error || body.message || `HTTP ${res.status}`
      }
      clearSelection()
      router.reload({ only: ['files', 'pagination'] })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  const runScan = async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/workshop/scan', { method: 'POST' })
      const data = await res.json()
      if (!data.available) {
        setScanResult('Drive unavailable — reconnect the data drive and try again.')
      } else {
        setScanResult(
          `${data.added} added, ${data.updated} updated, ${data.orphaned} removed, ` +
            `${data.thumbnails_generated} thumbnails`
        )
        // Refresh the page data so the grid reflects the new state.
        router.reload({ only: ['files', 'pagination'] })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setScanResult(`Scan failed: ${msg}`)
    } finally {
      setScanning(false)
    }
  }

  const reloadFiles = () => {
    router.reload({ only: ['files', 'pagination'] })
  }

  return (
    <AppLayout>
      <Head title="Workshop" />

      <WorkshopRightsModal
        open={rightsOpen}
        onAccept={() => setRightsOpen(false)}
      />

      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-desert-green flex items-center gap-2">
              <IconBox size={32} /> Workshop
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Offline maker library — 3D prints, CAD files, PDFs, and reference images. Drop files
              below, or copy them into{' '}
              <code className="bg-gray-100 px-1 rounded">storage/stl-library/&lt;category&gt;/</code>{' '}
              on your data drive and run a scan.
            </p>
          </div>
          <StyledButton variant="primary" icon="IconRefresh" loading={scanning} onClick={runScan}>
            {scanning ? 'Scanning…' : 'Rescan library'}
          </StyledButton>
        </header>

        {scanResult && (
          <div className="mb-4 rounded border border-desert-green bg-desert-green-light/10 px-3 py-2 text-sm text-gray-800">
            {scanResult}
          </div>
        )}

        {props.unavailable ? (
          <UnavailablePanel info={props.unavailable} />
        ) : (
          <>
            {props.upload_permitted ? (
              <UploadDropZone categories={props.enums.categories} onComplete={reloadFiles} />
            ) : (
              <LanOnlyNotice reason={props.upload_permitted_reason} />
            )}

            <div className="flex flex-col md:flex-row gap-4">
              <WorkshopFilters
                filters={props.filters}
                enums={props.enums}
                total={props.pagination?.total ?? 0}
              />
              <div className="flex-1">
                {props.files.length === 0 ? (
                  <EmptyState filters={props.filters} uploadPermitted={props.upload_permitted} />
                ) : (
                  <>
                    {selected.size > 0 && (
                      <WorkshopBatchBar
                        selectedCount={selected.size}
                        pageCount={pageIds.length}
                        allOnPageSelected={allOnPageSelected}
                        enums={props.enums}
                        onSelectAllOnPage={selectAllOnPage}
                        onClearSelection={clearSelection}
                        onRun={runBatch}
                      />
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {props.files.map((f) => (
                        <StlCard
                          key={f.id}
                          file={f}
                          selectable
                          selected={selected.has(f.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))}
                    </div>
                    {props.pagination && props.pagination.last_page > 1 && (
                      <Pager pagination={props.pagination} filters={props.filters} />
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function LanOnlyNotice({ reason }: { reason: string | null }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <IconNetworkOff size={20} className="shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
      <div>
        <p className="font-medium">
          {reason ?? 'Upload is enabled only from devices on your local network.'}
        </p>
        <p className="mt-1 text-amber-800">
          Drop files into{' '}
          <code className="bg-white px-1 rounded border border-amber-200">
            storage/stl-library/&lt;category&gt;/
          </code>{' '}
          on your data drive, then use <strong>Rescan library</strong>.
        </p>
      </div>
    </div>
  )
}

function UnavailablePanel({ info }: { info: StlLibraryUnavailable }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center">
      <IconAlertTriangle size={48} className="text-amber-500 mx-auto mb-3" />
      <h2 className="text-xl font-semibold text-amber-900 mb-2">Workshop unavailable</h2>
      <p className="text-amber-800 mb-1">
        The data drive holding the STL library is not mounted.
      </p>
      <p className="text-sm text-amber-700">
        Looked for: <code className="bg-white px-1 rounded">{info.library_root}</code>
      </p>
      <p className="text-sm text-amber-700 mt-3">
        Reconnect the drive and refresh this page.
      </p>
    </div>
  )
}

function EmptyState({
  filters,
  uploadPermitted,
}: {
  filters: StlListFilters
  uploadPermitted: boolean
}) {
  const filtered =
    !!filters.file_type ||
    !!filters.category ||
    !!filters.material ||
    !!filters.difficulty ||
    filters.pending_metadata !== undefined ||
    !!filters.search

  if (filtered) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-600">
        <IconBox size={48} className="mx-auto text-gray-300 mb-3" />
        <p className="font-medium mb-1">No files match these filters</p>
        <p className="text-sm">Try clearing one or more filters from the sidebar.</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-600">
      <IconBox size={48} className="mx-auto text-gray-300 mb-3" />
      <p className="font-medium mb-1">Library is empty</p>
      <p className="text-sm">
        {uploadPermitted ? (
          <>Drop files into the upload zone above to get started.</>
        ) : (
          <>
            Drop STL, 3MF, CAD, PDF, or image files into{' '}
            <code className="bg-gray-100 px-1 rounded">storage/stl-library/&lt;category&gt;/</code>{' '}
            on your data drive, then click <strong>Rescan library</strong>.
          </>
        )}
      </p>
    </div>
  )
}

function Pager({ pagination, filters }: { pagination: Pagination; filters: StlListFilters }) {
  const { current_page: current, last_page: last } = pagination

  const goTo = (page: number) => {
    const target = Math.min(Math.max(1, page), last)
    if (target === current) return
    // Navigate via Inertia preserving every active filter + per_page; only the
    // page number changes. WorkshopFilters owns filter changes; this owns page.
    router.get(
      '/workshop',
      { ...filters, page: target },
      { preserveScroll: true, preserveState: true }
    )
  }

  const tokens = pageList(current, last)

  return (
    <nav
      className="mt-6 flex flex-wrap items-center justify-center gap-2"
      aria-label="Pagination"
    >
      <button
        disabled={current === 1}
        onClick={() => goTo(current - 1)}
        className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-40"
      >
        Previous
      </button>

      <div className="flex items-center gap-1">
        {tokens.map((tok, i) =>
          tok === '…' ? (
            <span key={`gap-${i}`} className="px-2 text-sm text-gray-400 select-none">
              …
            </span>
          ) : (
            <button
              key={tok}
              onClick={() => goTo(tok)}
              aria-current={tok === current ? 'page' : undefined}
              className={[
                'min-w-[2rem] px-2 py-1 rounded border text-sm',
                tok === current
                  ? 'border-desert-green bg-desert-green text-white font-semibold'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {tok}
            </button>
          )
        )}
      </div>

      <button
        disabled={current === last}
        onClick={() => goTo(current + 1)}
        className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-40"
      >
        Next
      </button>

      <span className="ml-2 text-sm text-gray-600">
        Page {current} of {last}
      </span>
    </nav>
  )
}
