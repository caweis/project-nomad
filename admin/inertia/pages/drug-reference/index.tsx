import { useState, useCallback, useRef } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import DrugResultRow from '~/components/drug-reference/DrugResultRow'
import IngestStatus from '~/components/drug-reference/IngestStatus'
import ConditionsBrowse from '~/components/conditions/ConditionsBrowse'
import type { DrugSearchResult, DrugIngestStatus } from '../../../types/drug_reference'
import type { ConditionSummary } from '../../../types/conditions'
import { PRODUCT_TYPES } from '../../../types/drug_reference'

interface PageProps {
  ingestStatus: DrugIngestStatus | null
  rowCount: number
  conditions: ConditionSummary[]
}

type DrugTab = 'search' | 'conditions'

const DEBOUNCE_MS = 350

/** Read the initial tab from ?tab= so /drug-reference?tab=conditions deep-links. */
function initialTab(): DrugTab {
  if (typeof window === 'undefined') return 'search'
  return new URLSearchParams(window.location.search).get('tab') === 'conditions'
    ? 'conditions'
    : 'search'
}

/**
 * Drug Reference search page.
 *
 * Empty state (rowCount === 0): shows a "download FDA drug data" prompt +
 * the IngestStatus component. Once data is loaded, shows the search box,
 * OTC/Rx filter pills, collapsed results, and pagination.
 */
export default function DrugReferenceIndex({ ingestStatus, rowCount, conditions }: PageProps) {
  const [tab, setTab] = useState<DrugTab>(initialTab)
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
  const [ingesting, setIngesting] = useState(false)
  const [status, setStatus] = useState<DrugIngestStatus | null>(ingestStatus)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Top-level phase derived from the two sub-phases. `busy` = a phase is running.
  const phase = status?.phase ?? 'idle'
  const busy = phase === 'downloading' || phase === 'ingesting'
  // The manual "Ingest into search" button is available once parts are on disk
  // (download completed) and ingest is not already running. phase 'downloaded'
  // and 'failed' (with a completed download) both qualify.
  const canIngestFromDisk =
    status?.download.state === 'completed' && status?.ingest.state !== 'running'

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

  const refreshStatus = async () => {
    const statusResp = await fetch('/api/drug-reference/status')
    if (statusResp.ok) setStatus(await statusResp.json())
  }

  // Primary action — start the download phase (auto-chains ingest on completion).
  const handleTriggerDownload = async () => {
    if (triggering) return
    setTriggering(true)
    try {
      const resp = await fetch('/api/drug-reference/download', { method: 'POST' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      await refreshStatus()
    } catch {
      // ignore — status will update on next poll
    } finally {
      setTriggering(false)
    }
  }

  // Secondary action — re-run ingest from the on-disk parts (no re-download).
  const handleIngestFromDisk = async () => {
    if (ingesting) return
    setIngesting(true)
    try {
      const resp = await fetch('/api/drug-reference/ingest', { method: 'POST' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      await refreshStatus()
    } catch {
      // ignore — status will update on next poll
    } finally {
      setIngesting(false)
    }
  }

  const handleStatusRefresh = async () => {
    try {
      const resp = await fetch('/api/drug-reference/status')
      if (resp.ok) {
        const newStatus = (await resp.json()) as DrugIngestStatus
        setStatus(newStatus)
        // If ingest just finished, reload the page to show updated rowCount.
        if (newStatus.phase === 'ready' && newStatus.rowCount > rowCount) {
          router.reload({ only: ['rowCount', 'ingestStatus'] })
        }
      }
    } catch {
      // ignore
    }
  }

  const isEmpty = rowCount === 0

  // Switch tabs and keep the URL's ?tab= in sync (without a server round-trip) so
  // the conditions tab stays deep-linkable and refresh/back land where expected.
  const switchTab = (next: DrugTab) => {
    setTab(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (next === 'conditions') url.searchParams.set('tab', 'conditions')
      else url.searchParams.delete('tab')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
      active
        ? 'border-desert-green text-desert-green'
        : 'border-transparent text-gray-500 hover:text-desert-green hover:border-desert-green-lighter'
    }`

  return (
    <AppLayout>
      <Head title="Drug Reference" />

      <div className="p-4 max-w-4xl mx-auto">
        <div className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h1 className="text-2xl font-bold">Drug Reference</h1>
            {tab === 'search' && rowCount > 0 && (
              <Link href="/drug-reference/interactions">
                <StyledButton variant="outline" size="sm" onClick={() => {}}>
                  Compare interactions
                </StyledButton>
              </Link>
            )}
          </div>
          <p className="text-sm opacity-70">
            {tab === 'search'
              ? `Offline FDA drug labels — Rx + OTC. Search ${
                  rowCount > 0 ? `${rowCount.toLocaleString()} labels` : 'once data is downloaded'
                }.`
              : 'Find the right over-the-counter drug for a situation, from offline FDA labels.'}
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 mb-6" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'search'}
            className={tabClass(tab === 'search')}
            onClick={() => switchTab('search')}
          >
            Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'conditions'}
            className={tabClass(tab === 'conditions')}
            onClick={() => switchTab('conditions')}
          >
            When to use what
          </button>
        </div>

        {tab === 'conditions' ? (
          <ConditionsBrowse conditions={conditions} drugRowCount={rowCount} />
        ) : isEmpty ? (
          // ── Empty state ────────────────────────────────────────────────────
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <p className="text-lg font-semibold mb-2">No FDA drug data yet</p>
            <p className="mb-6 opacity-70">
              Download the openFDA drug-label dataset to enable offline search.
              Requires ~1.7 GB compressed download (~8–10 GB after ingestion).
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <StyledButton
                variant="primary"
                onClick={handleTriggerDownload}
                disabled={triggering || busy}
              >
                {phase === 'downloading'
                  ? 'Downloading…'
                  : phase === 'ingesting'
                    ? 'Indexing…'
                    : triggering
                      ? 'Starting…'
                      : 'Download FDA drug data'}
              </StyledButton>

              {canIngestFromDisk && (
                <StyledButton
                  variant="secondary"
                  onClick={handleIngestFromDisk}
                  disabled={ingesting || busy}
                >
                  {ingesting ? 'Starting…' : 'Ingest into search'}
                </StyledButton>
              )}
            </div>

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
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold">FDA data</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {canIngestFromDisk && (
                    <StyledButton
                      variant="outline"
                      size="sm"
                      onClick={handleIngestFromDisk}
                      disabled={ingesting || busy}
                    >
                      {ingesting ? 'Starting…' : 'Ingest into search'}
                    </StyledButton>
                  )}
                  <StyledButton
                    variant="secondary"
                    onClick={handleTriggerDownload}
                    disabled={triggering || busy}
                  >
                    {phase === 'downloading'
                      ? 'Downloading…'
                      : phase === 'ingesting'
                        ? 'Indexing…'
                        : 'Update FDA data'}
                  </StyledButton>
                </div>
              </div>
              {status && <IngestStatus status={status} onRefresh={handleStatusRefresh} />}
            </div>
          </>
        )}

        {/* ── Source citation (CC0, no-endorsement) — search tab only; the
              conditions tab carries its own citation footer. ─────────────── */}
        {tab === 'search' && (
          <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
            <strong>Source:</strong> U.S. Food &amp; Drug Administration drug labeling, via{' '}
            <strong>openFDA</strong> — public domain (CC0 1.0). NOMAD is not affiliated with or
            endorsed by the FDA. Label data is provided as-is; do not rely on it for medical
            decisions.
          </footer>
        )}
      </div>
    </AppLayout>
  )
}
