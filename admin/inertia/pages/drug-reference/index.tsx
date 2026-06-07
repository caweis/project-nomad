import { useState, useCallback, useRef } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import DrugResultRow from '~/components/drug-reference/DrugResultRow'
import IngestStatus from '~/components/drug-reference/IngestStatus'
import type { DrugSearchResult, DrugIngestStatus } from '../../../types/drug_reference'
import { PRODUCT_TYPES } from '../../../types/drug_reference'

interface PageProps {
  ingestStatus: DrugIngestStatus | null
  rowCount: number
}

const DEBOUNCE_MS = 350

/**
 * Drug Reference search page.
 *
 * Empty state (rowCount === 0): shows a "download FDA drug data" prompt +
 * the IngestStatus component. Once data is loaded, shows the search box,
 * OTC/Rx filter pills, collapsed results, and pagination.
 */
export default function DrugReferenceIndex({ ingestStatus, rowCount }: PageProps) {
  const [query, setQuery] = useState('')
  const [productType, setProductType] = useState<string | null>(null)
  const [scope, setScope] = useState<'name' | 'indication'>('name')
  const [results, setResults] = useState<DrugSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [status, setStatus] = useState<DrugIngestStatus | null>(ingestStatus)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const LIMIT = 50

  const doSearch = useCallback(
    async (q: string, pt: string | null, sc: 'name' | 'indication', off: number, append: boolean) => {
      if (!q.trim()) {
        setResults([])
        setSearched(false)
        setHasMore(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ q, limit: String(LIMIT), offset: String(off) })
        if (pt) params.set('product_type', pt)
        if (sc === 'indication') params.set('scope', 'indication')
        const resp = await fetch(`/api/drug-reference/search?${params}`)
        if (!resp.ok) throw new Error(`Search failed: HTTP ${resp.status}`)
        const json = (await resp.json()) as { results: DrugSearchResult[] }
        const newResults = json.results ?? []
        setResults(append ? (prev) => [...prev, ...newResults] : newResults)
        setHasMore(newResults.length === LIMIT)
        setSearched(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    setOffset(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(val, productType, scope, 0, false)
    }, DEBOUNCE_MS)
  }

  const handleFilterChange = (pt: string | null) => {
    setProductType(pt)
    setOffset(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSearch(query, pt, scope, 0, false)
  }

  const handleScopeChange = (sc: 'name' | 'indication') => {
    setScope(sc)
    setOffset(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSearch(query, productType, sc, 0, false)
  }

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT
    setOffset(newOffset)
    doSearch(query, productType, scope, newOffset, true)
  }

  const handleTriggerIngest = async () => {
    if (triggering) return
    setTriggering(true)
    try {
      const resp = await fetch('/api/drug-reference/download', { method: 'POST' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      // Refresh status after trigger
      const statusResp = await fetch('/api/drug-reference/status')
      if (statusResp.ok) {
        const newStatus = await statusResp.json()
        setStatus(newStatus)
      }
    } catch {
      // ignore — status will update on next poll
    } finally {
      setTriggering(false)
    }
  }

  const handleStatusRefresh = async () => {
    try {
      const resp = await fetch('/api/drug-reference/status')
      if (resp.ok) {
        const newStatus = await resp.json()
        setStatus(newStatus)
        // If ingest just completed, reload the page to show updated rowCount
        if (newStatus.state === 'completed' && newStatus.rowCount > rowCount) {
          router.reload({ only: ['rowCount', 'ingestStatus'] })
        }
      }
    } catch {
      // ignore
    }
  }

  const isEmpty = rowCount === 0

  return (
    <AppLayout>
      <Head title="Drug Reference" />

      <div className="p-4 max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h1 className="text-2xl font-bold">Drug Reference</h1>
            {rowCount > 0 && (
              <Link href="/drug-reference/interactions">
                <StyledButton variant="outline" size="sm" onClick={() => {}}>
                  Compare interactions
                </StyledButton>
              </Link>
            )}
          </div>
          <p className="text-sm opacity-70">
            Offline FDA drug labels — Rx + OTC. Search {rowCount > 0 ? `${rowCount.toLocaleString()} labels` : 'once data is downloaded'}.
          </p>
        </div>

        {isEmpty ? (
          // ── Empty state ────────────────────────────────────────────────────
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <p className="text-lg font-semibold mb-2">No FDA drug data yet</p>
            <p className="mb-6 opacity-70">
              Download the openFDA drug-label dataset to enable offline search.
              Requires ~1.7 GB compressed download (~8–10 GB after ingestion).
            </p>

            <StyledButton
              variant="primary"
              onClick={handleTriggerIngest}
              disabled={triggering || status?.state === 'running'}
            >
              {status?.state === 'running'
                ? 'Downloading…'
                : triggering
                ? 'Starting…'
                : 'Download FDA drug data'}
            </StyledButton>

            {status && (
              <div className="mt-6">
                <IngestStatus status={status} onRefresh={handleStatusRefresh} />
              </div>
            )}
          </div>
        ) : (
          // ── Search UI ──────────────────────────────────────────────────────
          <>
            {/* Search box */}
            <div className="mb-3">
              <input
                type="text"
                value={query}
                onChange={handleQueryChange}
                placeholder={
                  scope === 'indication'
                    ? 'Search by condition — e.g. heartburn, allergies, high blood pressure'
                    : 'Search by drug name or generic name…'
                }
                className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-desert-green"
              />
            </div>

            {/* Scope toggle — Name vs What it treats */}
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              <span className="text-xs text-gray-500 mr-1">Search by:</span>
              <button
                type="button"
                onClick={() => handleScopeChange('name')}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  scope === 'name'
                    ? 'bg-desert-green text-white border-desert-green'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-desert-green'
                }`}
              >
                Name
              </button>
              <button
                type="button"
                onClick={() => handleScopeChange('indication')}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  scope === 'indication'
                    ? 'bg-desert-green text-white border-desert-green'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-desert-green'
                }`}
              >
                What it treats
              </button>
            </div>

            {/* OTC / Rx filter pills */}
            <div className="flex gap-2 mb-4 flex-wrap">
              <button
                type="button"
                onClick={() => handleFilterChange(null)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  productType === null
                    ? 'bg-desert-green text-white border-desert-green'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-desert-green'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(PRODUCT_TYPES.OTC)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  productType === PRODUCT_TYPES.OTC
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-600'
                }`}
              >
                OTC
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange(PRODUCT_TYPES.RX)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  productType === PRODUCT_TYPES.RX
                    ? 'bg-orange-600 text-white border-orange-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-orange-600'
                }`}
              >
                Rx
              </button>
            </div>

            {/* Results */}
            {loading && results.length === 0 && (
              <div className="text-center py-8 opacity-60">Searching…</div>
            )}

            {error && (
              <div className="text-red-600 text-sm mb-4 p-3 bg-red-50 rounded">{error}</div>
            )}

            {searched && results.length === 0 && !loading && (
              <div className="text-center py-8 opacity-60">No results for "{query}"</div>
            )}

            {results.length > 0 && (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  Showing {results.length} result{results.length !== 1 ? 's' : ''}
                  {query ? ` for "${query}"` : ''}
                </p>
                <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
                  {results.map((r) => (
                    <DrugResultRow key={`${r.id}`} result={r} />
                  ))}
                </div>

                {hasMore && (
                  <div className="mt-4 flex justify-center">
                    <StyledButton
                      variant="secondary"
                      onClick={handleLoadMore}
                      disabled={loading}
                    >
                      {loading ? 'Loading…' : 'Load more'}
                    </StyledButton>
                  </div>
                )}
              </>
            )}

            {/* Update control */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">FDA data</h3>
                <StyledButton
                  variant="secondary"
                  onClick={handleTriggerIngest}
                  disabled={triggering || status?.state === 'running'}
                >
                  {status?.state === 'running' ? 'Updating…' : 'Update FDA data'}
                </StyledButton>
              </div>
              {status && <IngestStatus status={status} onRefresh={handleStatusRefresh} />}
            </div>
          </>
        )}

        {/* ── Source citation (CC0, no-endorsement) ───────────────────────── */}
        <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
          <strong>Source:</strong> U.S. Food &amp; Drug Administration drug labeling, via{' '}
          <strong>openFDA</strong> — public domain (CC0 1.0). NOMAD is not affiliated with or
          endorsed by the FDA. Label data is provided as-is; do not rely on it for medical
          decisions.
        </footer>
      </div>
    </AppLayout>
  )
}
