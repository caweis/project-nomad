import { useState } from 'react'
import { Head, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StlCard from '~/components/workshop/StlCard'
import WorkshopFilters from '~/components/workshop/WorkshopFilters'
import WorkshopRightsModal from '~/components/workshop/WorkshopRightsModal'
import StyledButton from '~/components/StyledButton'
import { IconRefresh, IconAlertTriangle, IconBox } from '@tabler/icons-react'
import type {
  StlCategory,
  StlDifficulty,
  StlFileSlim,
  StlListFilters,
  StlLibraryUnavailable,
  StlMaterial,
} from '../../../types/stl_library'

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
    categories: { value: StlCategory; label: string }[]
    materials: StlMaterial[]
    difficulties: StlDifficulty[]
  }
  rights_acknowledged: boolean
}

export default function WorkshopIndex(props: PageProps) {
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [rightsOpen, setRightsOpen] = useState(!props.rights_acknowledged)

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
              Offline catalog of 3D-printable files. Drop STLs into{' '}
              <code className="bg-gray-100 px-1 rounded">storage/stl-library/&lt;category&gt;/</code>{' '}
              on your data drive, then run a scan.
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
          <div className="flex flex-col md:flex-row gap-4">
            <WorkshopFilters
              filters={props.filters}
              enums={props.enums}
              total={props.pagination?.total ?? 0}
            />
            <div className="flex-1">
              {props.files.length === 0 ? (
                <EmptyState filters={props.filters} />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {props.files.map((f) => (
                      <StlCard key={f.id} file={f} />
                    ))}
                  </div>
                  {props.pagination && props.pagination.last_page > 1 && (
                    <Pager pagination={props.pagination} filters={props.filters} />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
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

function EmptyState({ filters }: { filters: StlListFilters }) {
  const filtered =
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
    <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center text-gray-600">
      <IconBox size={48} className="mx-auto text-gray-300 mb-3" />
      <p className="font-medium mb-1">Library is empty</p>
      <p className="text-sm mb-3">
        Drop <code className="bg-gray-100 px-1 rounded">.stl</code> or{' '}
        <code className="bg-gray-100 px-1 rounded">.3mf</code> files into{' '}
        <code className="bg-gray-100 px-1 rounded">storage/stl-library/</code> under
        your data drive, organized into subfolders like{' '}
        <code className="bg-gray-100 px-1 rounded">medical/</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">tools/</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">household/</code>.
      </p>
      <p className="text-sm">Then click <strong>Rescan library</strong> above.</p>
    </div>
  )
}

function Pager({ pagination, filters }: { pagination: Pagination; filters: StlListFilters }) {
  const goTo = (page: number) => {
    router.get(
      '/workshop',
      { ...filters, page },
      { preserveScroll: true, preserveState: true }
    )
  }
  return (
    <nav className="flex items-center justify-center gap-2 mt-6">
      <button
        disabled={pagination.current_page === 1}
        onClick={() => goTo(pagination.current_page - 1)}
        className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-sm text-gray-600">
        Page {pagination.current_page} of {pagination.last_page}
      </span>
      <button
        disabled={pagination.current_page === pagination.last_page}
        onClick={() => goTo(pagination.current_page + 1)}
        className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  )
}
