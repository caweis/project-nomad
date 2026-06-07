import { Head, Link } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import { IconListCheck, IconChecks } from '@tabler/icons-react'
import {
  SCENARIOS,
  SCENARIO_LABELS,
  type Scenario,
  type ScenarioPlanSlim,
} from '../../../types/scenarios'

interface Enums {
  scenarios: { value: Scenario; label: string }[]
}

interface PageProps {
  plans: ScenarioPlanSlim[]
  enums: Enums
}

/** Badge color per scenario, mirroring the inventory category badge styling. */
const SCENARIO_BADGE: Record<Scenario, string> = {
  blackout: 'bg-amber-100 text-amber-900',
  evacuation: 'bg-red-100 text-red-900',
  medical: 'bg-rose-100 text-rose-900',
  'water-contamination': 'bg-sky-100 text-sky-900',
  other: 'bg-gray-100 text-gray-700',
}

/**
 * Scenario Plans list page (Phase 3). Plans grouped by scenario, each card
 * badged by scenario and showing its done/total step tally. Mirrors the
 * Inventory list page's card grid + header + empty state.
 */
export default function PlansIndex({ plans }: PageProps) {
  // Group plans by scenario, preserving the canonical scenario order.
  const grouped = SCENARIOS.map((scenario) => ({
    scenario,
    plans: plans.filter((p) => p.scenario === scenario),
  })).filter((g) => g.plans.length > 0)

  return (
    <AppLayout>
      <Head title="Scenario Plans" />

      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-desert-green flex items-center gap-2">
              <IconListCheck size={32} /> Scenario Plans
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Editable, checkable plans for the situations you prepare for. Each step can link
              to an inventory item, a printable file, or an offline article.
            </p>
          </div>

          <Link href="/plans/new">
            <StyledButton variant="primary" icon="IconPlus">
              New plan
            </StyledButton>
          </Link>
        </header>

        {plans.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <section key={group.scenario}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {SCENARIO_LABELS[group.scenario]}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.plans.map((plan) => (
                    <PlanCard key={plan.id} plan={plan} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function PlanCard({ plan }: { plan: ScenarioPlanSlim }) {
  const done = plan.total_steps > 0 && plan.checked_steps >= plan.total_steps
  return (
    <Link
      href={`/plans/${plan.id}`}
      className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-gray-900" title={plan.title}>
          {plan.title}
        </span>
        <span
          className={[
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            SCENARIO_BADGE[plan.scenario],
          ].join(' ')}
        >
          {SCENARIO_LABELS[plan.scenario]}
        </span>
      </div>

      {plan.description && (
        <p className="text-sm text-gray-600 line-clamp-2">{plan.description}</p>
      )}

      <div className="mt-auto flex items-center gap-1.5 text-xs text-gray-500">
        <IconChecks size={14} className={done ? 'text-emerald-600' : 'text-gray-400'} />
        {plan.checked_steps} / {plan.total_steps} step{plan.total_steps === 1 ? '' : 's'} done
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-600">
      <IconListCheck size={48} className="mx-auto text-gray-300 mb-3" />
      <p className="font-medium mb-1">No scenario plans yet</p>
      <p className="text-sm">
        Use <strong>New plan</strong> above to build a checklist for a situation you prepare for.
      </p>
    </div>
  )
}
