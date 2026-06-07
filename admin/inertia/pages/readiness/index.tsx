import { useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import InfoTooltip from '~/components/InfoTooltip'
import {
  IconShieldCheck,
  IconDroplet,
  IconToolsKitchen2,
  IconBolt,
  IconAlertTriangle,
  IconListCheck,
  IconChecks,
} from '@tabler/icons-react'
import { displayUnitLabel, fromBase, toBase } from '../../../util/units'
import type { ReadinessResource, ResourceReadiness, ReadinessStatus } from '../../../util/readiness'
import type { ReadinessDashboard } from '../../../types/readiness'
import type { MeasurementSystem } from '../../../types/inventory'
import {
  SCENARIOS,
  SCENARIO_LABELS,
  type Scenario,
  type ScenarioPlanSlim,
} from '../../../types/scenarios'

/**
 * Self-Reliance Suite — Preparedness.
 *
 * One page, two tabs:
 *   • Supply Readiness — the Phase 2 days-of-supply calculator: three
 *     per-resource cards (water / food / power) with days-of-supply, status
 *     pill, and gap, each carrying the CITED §5.1.1 "source:" tooltip; an
 *     expiry-warning panel; and a household-config form that PATCHes the
 *     existing /api/system/settings KV endpoint (one key per request, like the
 *     Inventory units toggle) then router.reload()s. Water is shown/entered in
 *     the user's measurement system via util/units.ts; food (kcal) and power
 *     (Wh) are system-agnostic. Stores no new stock — it reads Inventory.
 *   • Scenario Plans — the Phase 3 per-scenario checklist list (grouped by
 *     scenario, step tallies, "New plan" action). Clicking a plan opens
 *     /plans/:id; the detail/create pages link back here to ?tab=plans.
 *
 * The active tab comes from the server-resolved `tab` prop (driven by the
 * `?tab=supply|plans` query param), so it is linkable and survives
 * router.reload(). Switching tabs is an Inertia GET that preserves state/scroll
 * so the calculator's loaded data is not lost when toggling.
 */

type ReadinessTab = 'supply' | 'plans'

interface Enums {
  scenarios: { value: Scenario; label: string }[]
}

interface PageProps {
  dashboard: ReadinessDashboard
  plans: ScenarioPlanSlim[]
  enums: Enums
  tab: ReadinessTab
}

/** Cited provenance for each figure, surfaced in-app per spec §5.0 / §5.1.1. */
const SOURCE_NOTES: Record<ReadinessResource, string> = {
  water:
    'source: 1 US gallon (3.79 L) per person per day for drinking + sanitation. ' +
    'Children count as full persons — FEMA/Ready.gov/CDC note children, nursing ' +
    'mothers, and the ill need more, and needs can double in extreme heat. ' +
    'Ready.gov/water; FEMA FA-321; CDC emergency water.',
  food:
    'source: 2,000 kcal per person per day, the FDA Nutrition Facts general ' +
    'reference. Real needs span 1,000–3,200 kcal by age, sex, and activity ' +
    '(USDA/HHS Dietary Guidelines, Appendix 2) — adjust the per-person value to ' +
    'your household. FDA Nutrition Facts label; dietaryguidelines.gov.',
  power:
    'source: no authoritative per-person watt-hour standard exists — emergency ' +
    'power is device-dependent. Enter your own daily Wh need; 0 leaves power ' +
    'untracked.',
}

/** Cited basis for the 14-day default horizon. */
const HORIZON_SOURCE =
  'source: 14-day shelter-at-home supply (American Red Cross survival-kit list; ' +
  'FEMA FA-321 two-week supply). A 3-day minimum applies to evacuation.'

/** Cited basis for the user-entered pet inputs. */
const PET_SOURCE =
  'source: no authoritative per-pet gallon/calorie figure exists (AVMA gives ' +
  'durations only: 3–7 days food, 7+ days water). Enter your pets’ normal ' +
  'combined daily intake. Ready.gov/pets; AVMA pets-and-disasters.'

const STATUS_PILL: Record<ReadinessStatus, { label: string; className: string }> = {
  green: { label: 'On target', className: 'bg-green-100 text-green-800 border-green-300' },
  yellow: { label: 'Building', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  red: { label: 'Low', className: 'bg-red-100 text-red-800 border-red-300' },
  unset: { label: 'Not tracked', className: 'bg-gray-100 text-gray-600 border-gray-300' },
}

const RESOURCE_META: Record<
  ReadinessResource,
  { label: string; icon: React.ReactNode }
> = {
  water: { label: 'Water', icon: <IconDroplet size={28} /> },
  food: { label: 'Food', icon: <IconToolsKitchen2 size={28} /> },
  power: { label: 'Power', icon: <IconBolt size={28} /> },
}

export default function ReadinessIndex({ dashboard, plans, tab }: PageProps) {
  /**
   * Switch tabs via an Inertia GET that updates `?tab`. preserveState keeps the
   * config form's local edits and preserveScroll avoids a jump; the server
   * re-supplies both datasets so neither tab needs a second fetch.
   */
  const goTo = (next: ReadinessTab) => {
    if (next === tab) return
    router.get('/readiness', { tab: next }, { preserveState: true, preserveScroll: true })
  }

  return (
    <AppLayout>
      <Head title="Preparedness" />

      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <header className="mb-4">
          <h1 className="text-3xl font-bold text-desert-green flex items-center gap-2">
            <IconShieldCheck size={32} /> Preparedness
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Your days-of-supply against a target, plus checkable plans for the situations you
            prepare for.
          </p>
        </header>

        <TabBar active={tab} onChange={goTo} />

        {tab === 'plans' ? (
          <ScenarioPlansTab plans={plans} />
        ) : (
          <SupplyReadinessTab dashboard={dashboard} />
        )}
      </div>
    </AppLayout>
  )
}

/** The two-tab selector for the planner. StyledButton-free; plain buttons. */
function TabBar({
  active,
  onChange,
}: {
  active: ReadinessTab
  onChange: (tab: ReadinessTab) => void
}) {
  const tabs: { id: ReadinessTab; label: string; icon: React.ReactNode }[] = [
    { id: 'supply', label: 'Supply Readiness', icon: <IconShieldCheck size={18} /> },
    { id: 'plans', label: 'Scenario Plans', icon: <IconListCheck size={18} /> },
  ]
  return (
    <div className="border-b border-gray-200 mb-6">
      <nav className="-mb-px flex gap-6" aria-label="Preparedness tabs">
        {tabs.map((t) => {
          const isActive = t.id === active
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'inline-flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-desert-green text-desert-green'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
              ].join(' ')}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

// ─── Supply Readiness tab ─────────────────────────────────────────────────────

function SupplyReadinessTab({ dashboard }: { dashboard: ReadinessDashboard }) {
  const { resources, expiryWarnings, targetHorizonDays, measurementSystem } = dashboard

  return (
    <>
      <p className="text-sm text-gray-600 mb-4">
        How many days of water, food, and power you have on hand against a {targetHorizonDays}-day
        target, computed from your Inventory. Every figure cites its source.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {resources.map((r) => (
          <ResourceCard key={r.resource} readiness={r} system={measurementSystem} />
        ))}
      </div>

      <ExpiryPanel warnings={expiryWarnings} horizon={targetHorizonDays} system={measurementSystem} />

      <ConfigForm dashboard={dashboard} />
    </>
  )
}

// ─── Scenario Plans tab ───────────────────────────────────────────────────────

/** Badge color per scenario, mirroring the inventory category badge styling. */
const SCENARIO_BADGE: Record<Scenario, string> = {
  blackout: 'bg-amber-100 text-amber-900',
  evacuation: 'bg-red-100 text-red-900',
  medical: 'bg-rose-100 text-rose-900',
  'water-contamination': 'bg-sky-100 text-sky-900',
  other: 'bg-gray-100 text-gray-700',
}

/**
 * Scenario-plans list (moved here from the former standalone plans/index page).
 * Plans grouped by scenario, each card badged and showing its done/total step
 * tally. Clicking a plan opens /plans/:id; "New plan" opens /plans/new.
 */
function ScenarioPlansTab({ plans }: { plans: ScenarioPlanSlim[] }) {
  // Group plans by scenario, preserving the canonical scenario order.
  const grouped = SCENARIOS.map((scenario) => ({
    scenario,
    plans: plans.filter((p) => p.scenario === scenario),
  })).filter((g) => g.plans.length > 0)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <p className="text-sm text-gray-600">
          Editable, checkable plans for the situations you prepare for. Each step can link to an
          inventory item, a printable file, or an offline article.
        </p>
        <Link href="/plans/new">
          <StyledButton variant="primary" icon="IconPlus">
            New plan
          </StyledButton>
        </Link>
      </div>

      {plans.length === 0 ? (
        <PlansEmptyState />
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

function PlansEmptyState() {
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

function ResourceCard({
  readiness,
  system,
}: {
  readiness: ResourceReadiness
  system: MeasurementSystem
}) {
  const meta = RESOURCE_META[readiness.resource]
  const pill = STATUS_PILL[readiness.status]
  const unitLabel = displayUnitLabel(readiness.resource, system)
  const haveDisplay = round2(fromBase(readiness.resource, readiness.haveBase, system))
  const gapDisplay = round2(fromBase(readiness.resource, readiness.gapBase, system))

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <span className="text-desert-green">{meta.icon}</span>
          {meta.label}
          <InfoTooltip text={SOURCE_NOTES[readiness.resource]} />
        </h2>
        <span className={`text-xs font-semibold rounded-full border px-2.5 py-1 ${pill.className}`}>
          {pill.label}
        </span>
      </div>

      {readiness.status === 'unset' ? (
        <div className="mt-4 flex-1">
          <p className="text-gray-500 text-sm">
            Set a daily {meta.label.toLowerCase()} need below to start tracking this.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <div className="text-4xl font-bold text-desert-green">
              {readiness.days === null ? '—' : round1(readiness.days)}
              <span className="text-base font-normal text-gray-500 ml-1">days</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">of a {readiness.targetDays}-day target</p>
          </div>

          <dl className="mt-4 text-sm space-y-1 flex-1">
            <div className="flex justify-between">
              <dt className="text-gray-500">On hand</dt>
              <dd className="font-medium text-gray-800">
                {haveDisplay} {unitLabel}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Daily need</dt>
              <dd className="font-medium text-gray-800">
                {round2(fromBase(readiness.resource, readiness.dailyNeed, system))} {unitLabel}/day
              </dd>
            </div>
          </dl>

          {readiness.gapBase > 0 && (
            <p className="mt-3 text-sm text-desert-stone-dark">
              Need <strong>{gapDisplay} {unitLabel}</strong> more to reach {readiness.targetDays}{' '}
              days.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ExpiryPanel({
  warnings,
  horizon,
  system,
}: {
  warnings: ReadinessDashboard['expiryWarnings']
  horizon: number
  system: MeasurementSystem
}) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 mb-6 text-sm text-gray-600">
        No contributing stock expires before the {horizon}-day window.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 mb-6">
      <h2 className="text-base font-semibold text-yellow-900 flex items-center gap-2">
        <IconAlertTriangle size={18} />
        {warnings.length} item{warnings.length === 1 ? '' : 's'} expire before day {horizon}
      </h2>
      <p className="text-xs text-yellow-800 mt-0.5">
        These are still counted in your on-hand totals — they just won&apos;t last the full window.
      </p>
      <ul className="mt-3 space-y-1.5">
        {warnings.map((w) => {
          const unitLabel = displayUnitLabel(w.resource, system)
          const amount = round2(fromBase(w.resource, w.amountBase, system))
          return (
            <li key={w.id} className="text-sm flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/inventory/${w.id}`} className="text-desert-green hover:underline font-medium">
                {w.name}
              </Link>
              <span className="text-yellow-900">
                {amount} {unitLabel} of {RESOURCE_META[w.resource].label.toLowerCase()}
                {w.expiryDate ? ` · expires ${w.expiryDate}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ConfigForm({ dashboard }: { dashboard: ReadinessDashboard }) {
  const system = dashboard.measurementSystem
  const c = dashboard.config

  // Water needs are stored in base units (L); show/edit them in the display unit.
  const [form, setForm] = useState({
    adults: String(c.adults),
    children: String(c.children),
    targetHorizonDays: String(c.targetHorizonDays),
    waterPerPerson: String(round3(fromBase('water', c.needs.water, system))),
    foodPerPerson: String(round1(c.needs.food)),
    petWaterPerDay: String(round3(fromBase('water', c.petWaterPerDay, system))),
    petFoodPerDay: String(round1(c.petFoodPerDay)),
    powerPerDay: String(round1(c.powerPerDay)),
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const waterUnit = displayUnitLabel('water', system)

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)

    // Build the base-unit needs JSON. food/power are system-agnostic; water
    // converts from the display unit back to liters.
    const needs = {
      water: toBase('water', toNonNegativeNumber(form.waterPerPerson), system),
      food: toNonNegativeNumber(form.foodPerPerson),
      power: toNonNegativeNumber(form.powerPerDay) > 0 ? toNonNegativeNumber(form.powerPerDay) : 0,
    }

    // The per-person power need stays 0 (no per-person standard); the user's
    // daily Wh load lives in readiness.powerPerDay. Keep needs.power at 0.
    needs.power = 0

    const updates: { key: string; value: string }[] = [
      { key: 'readiness.householdAdults', value: String(toNonNegativeInt(form.adults)) },
      { key: 'readiness.householdChildren', value: String(toNonNegativeInt(form.children)) },
      {
        key: 'readiness.targetHorizonDays',
        value: String(clampHorizon(toNonNegativeInt(form.targetHorizonDays))),
      },
      { key: 'readiness.needs', value: JSON.stringify(needs) },
      {
        key: 'readiness.petWaterPerDay',
        value: String(toBase('water', toNonNegativeNumber(form.petWaterPerDay), system)),
      },
      { key: 'readiness.petFoodPerDay', value: String(toNonNegativeNumber(form.petFoodPerDay)) },
      { key: 'readiness.powerPerDay', value: String(toNonNegativeNumber(form.powerPerDay)) },
    ]

    try {
      for (const u of updates) {
        const res = await fetch('/api/system/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(u),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || body.message || `HTTP ${res.status}`)
        }
      }
      setMessage({ kind: 'ok', text: 'Saved' })
      router.reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Save failed: ${msg}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSave} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Household</h2>
      <p className="text-sm text-gray-500 mb-4">
        Children count as full persons for water and food — needs are never discounted by age
        (FEMA/Ready.gov). Pets and power are your own daily totals.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <NumberField
          label="Adults"
          value={form.adults}
          onChange={(v) => set('adults', v)}
          min={0}
          step={1}
        />
        <NumberField
          label="Children"
          value={form.children}
          onChange={(v) => set('children', v)}
          min={0}
          step={1}
        />
        <NumberField
          label="Target horizon (days)"
          value={form.targetHorizonDays}
          onChange={(v) => set('targetHorizonDays', v)}
          min={1}
          max={365}
          step={1}
          tooltip={HORIZON_SOURCE}
        />

        <NumberField
          label={`Water per person (${waterUnit}/day)`}
          value={form.waterPerPerson}
          onChange={(v) => set('waterPerPerson', v)}
          min={0}
          step={0.1}
          tooltip={SOURCE_NOTES.water}
        />
        <NumberField
          label="Food per person (kcal/day)"
          value={form.foodPerPerson}
          onChange={(v) => set('foodPerPerson', v)}
          min={0}
          step={50}
          tooltip={SOURCE_NOTES.food}
        />
        <NumberField
          label="Power need (Wh/day)"
          value={form.powerPerDay}
          onChange={(v) => set('powerPerDay', v)}
          min={0}
          step={50}
          tooltip={SOURCE_NOTES.power}
        />

        <NumberField
          label={`Pet water total (${waterUnit}/day)`}
          value={form.petWaterPerDay}
          onChange={(v) => set('petWaterPerDay', v)}
          min={0}
          step={0.1}
          tooltip={PET_SOURCE}
        />
        <NumberField
          label="Pet food total (kcal/day)"
          value={form.petFoodPerDay}
          onChange={(v) => set('petFoodPerDay', v)}
          min={0}
          step={50}
          tooltip={PET_SOURCE}
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        {/* StyledButton renders type="button", so submission is wired via
            onClick rather than the form's onSubmit. */}
        <StyledButton
          variant="primary"
          icon="IconDeviceFloppy"
          loading={saving}
          disabled={saving}
          onClick={() => onSave()}
        >
          Save
        </StyledButton>
        {message && (
          <span className={message.kind === 'ok' ? 'text-green-700 text-sm' : 'text-red-700 text-sm'}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  tooltip,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
  tooltip?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md bg-white px-3 py-2 text-sm text-gray-900 border border-gray-400 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-primary"
      />
    </div>
  )
}

// ─── pure display/parse helpers ──────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Coerce a form string to a finite, non-negative number (else 0). */
function toNonNegativeNumber(raw: string): number {
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Coerce a form string to a finite, non-negative integer (else 0). */
function toNonNegativeInt(raw: string): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Clamp the horizon into [1, 365], matching the service-side guard. */
function clampHorizon(days: number): number {
  if (!Number.isFinite(days) || days < 1) return 14
  return Math.min(days, 365)
}
