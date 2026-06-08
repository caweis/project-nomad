import { Head, Link } from '@inertiajs/react'
import { IconArrowLeft } from '@tabler/icons-react'
import AppLayout from '~/layouts/AppLayout'
import SafetyBanner from '~/components/conditions/SafetyBanner'
import DrugResultRow from '~/components/drug-reference/DrugResultRow'
import type { ConditionSummary } from '../../../types/conditions'
import type { DrugSearchResult } from '../../../types/drug_reference'

interface PageProps {
  condition: ConditionSummary | null
  drugs: DrugSearchResult[]
  drugRowCount: number
}

/**
 * "When to use what" — condition detail page.
 *
 * Header (condition label + category) + a prominent SafetyBanner + the OTC-first
 * list of drugs whose FDA label indications match this situation. Each row links
 * to its existing Drug Reference detail page. The empty state distinguishes
 * "no FDA data yet" (drugRowCount === 0 → point to Drug Reference) from
 * "data present, but nothing matched this situation".
 */
export default function ConditionsShow({ condition, drugs, drugRowCount }: PageProps) {
  const label = condition?.label ?? 'Condition'
  const noData = drugRowCount === 0

  return (
    <AppLayout>
      <Head title={label} />

      <div className="p-4 max-w-3xl mx-auto">
        {/* Back nav */}
        <div className="mb-4">
          <Link
            href="/conditions"
            className="inline-flex items-center gap-1 text-sm text-desert-green hover:underline"
          >
            <IconArrowLeft size={16} />
            When to use what
          </Link>
        </div>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{label}</h1>
          {condition?.category && (
            <p className="text-sm text-gray-500 mt-0.5">{condition.category}</p>
          )}
        </div>

        {/* Safety banner — hard ship requirement, top of content. */}
        <SafetyBanner />

        {/* Drug list / empty states */}
        {noData ? (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <p className="text-lg font-semibold mb-2">No drug data yet</p>
            <p className="mb-6 opacity-70">
              Download the offline FDA drug labels from Drug Reference to see matches for this
              situation.
            </p>
            <Link href="/drug-reference">
              <span className="inline-block rounded bg-desert-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-desert-green-dark">
                Go to Drug Reference
              </span>
            </Link>
          </div>
        ) : drugs.length === 0 ? (
          <div className="text-center py-8 opacity-60">
            No over-the-counter drugs match &ldquo;{label}&rdquo; in the current label data. Try
            searching by drug name in{' '}
            <Link href="/drug-reference" className="text-desert-green hover:underline">
              Drug Reference
            </Link>
            .
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-base font-semibold">Over-the-counter options</h2>
              <span className="text-xs text-gray-500">
                {drugs.length} result{drugs.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
              {drugs.map((d) => (
                <DrugResultRow key={`${d.id}`} result={d} />
              ))}
            </div>
          </>
        )}

        {/* ── Source citation ───────────────────────────────────────────────── */}
        <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500 space-y-1">
          <p>
            <strong>Source:</strong> U.S. Food &amp; Drug Administration drug labeling, via{' '}
            <strong>openFDA</strong> — public domain (CC0 1.0). NOMAD is not affiliated with or
            endorsed by the FDA.
          </p>
          <p>
            Matches are FDA label-indication text, not medical recommendations. Do not rely on this
            data to make decisions regarding medical care.
          </p>
        </footer>
      </div>
    </AppLayout>
  )
}
