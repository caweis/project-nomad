import { useState, useCallback, useRef, useMemo } from 'react'
import SafetyBanner from '~/components/conditions/SafetyBanner'
import ConditionCard from '~/components/conditions/ConditionCard'
import DrugResultRow from '~/components/drug-reference/DrugResultRow'
import type { ConditionSummary, ConditionDrugsResult } from '../../../types/conditions'
import type { DrugSearchResult } from '../../../types/drug_reference'

interface Props {
  conditions: ConditionSummary[]
  drugRowCount: number
}

const DEBOUNCE_MS = 350

/**
 * "When to use what" — condition browse body, shared between the Drug Reference
 * "When to use what" tab and the legacy /conditions page (which now redirects to
 * the tab). Renders the safety banner, free-text situation search, and the
 * curated condition grid. Contains no page chrome (AppLayout/Head/title) so it
 * can drop into either host.
 *
 * Empty state (drugRowCount === 0): the underlying FDA drug data hasn't been
 * downloaded, so there is nothing to match — point the user to the Search tab.
 */
export default function ConditionsBrowse({ conditions, drugRowCount }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DrugSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Group the curated conditions by category, preserving curated order.
  const grouped = useMemo(() => {
    const map = new Map<string, ConditionSummary[]>()
    for (const c of conditions) {
      const bucket = map.get(c.category) ?? []
      bucket.push(c)
      map.set(c.category, bucket)
    }
    return Array.from(map.entries())
  }, [conditions])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q })
      const resp = await fetch(`/api/conditions/drugs?${params}`)
      if (!resp.ok) throw new Error(`Search failed: HTTP ${resp.status}`)
      const json = (await resp.json()) as ConditionDrugsResult
      setResults(json.drugs ?? [])
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), DEBOUNCE_MS)
  }

  const isEmpty = drugRowCount === 0

  return (
    <div className="space-y-6">
      <p className="text-sm opacity-70">
        Pick a situation — or search one — to see over-the-counter drugs whose FDA labels list it.
      </p>

      {/* Safety banner — hard ship requirement, top of the browse body. */}
      <SafetyBanner />

      {isEmpty ? (
        // ── Empty state — no FDA data ingested yet ─────────────────────────────
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <p className="text-lg font-semibold mb-2">No drug data yet</p>
          <p className="mb-6 opacity-70">
            This reference matches situations against offline FDA drug labels. Download the data from
            the Search tab first to enable it.
          </p>
        </div>
      ) : (
        <>
          {/* Free-text situation search */}
          <div>
            <input
              type="text"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search a situation — e.g. diarrhea, poison ivy, sprain…"
              className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-desert-green"
            />
          </div>

          {/* Search results (free text) */}
          {loading && results.length === 0 && (
            <div className="text-center py-8 opacity-60">Searching…</div>
          )}

          {error && <div className="text-red-600 text-sm p-3 bg-red-50 rounded">{error}</div>}

          {searched && results.length === 0 && !loading && (
            <div className="text-center py-8 opacity-60">
              No over-the-counter drugs match &ldquo;{query}&rdquo;. Try a curated situation below, or
              search by drug name on the Search tab.
            </div>
          )}

          {results.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                {results.length} OTC result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
              </p>
              <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
                {results.map((r) => (
                  <DrugResultRow key={`${r.id}`} result={r} />
                ))}
              </div>
            </div>
          )}

          {/* Curated condition grid, grouped by category */}
          {!searched && (
            <div className="space-y-6">
              {grouped.map(([category, items]) => (
                <section key={category}>
                  <h2 className="text-sm font-semibold text-gray-700 mb-2">{category}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {items.map((c) => (
                      <ConditionCard key={c.slug} condition={c} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Source citation */}
      <footer className="mt-2 pt-4 border-t border-gray-200 text-xs text-gray-500">
        <strong>Source:</strong> U.S. Food &amp; Drug Administration drug labeling, via{' '}
        <strong>openFDA</strong> — public domain (CC0 1.0). NOMAD is not affiliated with or endorsed
        by the FDA. Matches are label-indication text only; do not rely on them for medical
        decisions.
      </footer>
    </div>
  )
}
