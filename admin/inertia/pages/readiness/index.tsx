import { useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import InfoTooltip from '~/components/InfoTooltip'
import InventoryCard from '~/components/inventory/InventoryCard'
import InventoryFilters from '~/components/inventory/InventoryFilters'
import {
  IconShieldCheck,
  IconDroplet,
  IconToolsKitchen2,
  IconBolt,
  IconAlertTriangle,
  IconListCheck,
  IconChecks,
  IconClipboardList,
  IconScale,
  IconInfoCircle,
  IconExternalLink,
  IconX,
  IconPaw,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react'
import { displayUnitLabel, fromBase, toBase } from '../../../util/units'
import { pageList } from '../../../util/workshop_pagination'
import {
  computeResourceReadiness,
  computePetLoad,
  petPersonEquivalent,
  daysWithoutPets,
} from '../../../util/readiness'
import type { ReadinessResource, ResourceReadiness, ReadinessStatus } from '../../../util/readiness'
import { PET_NEEDS, PET_TYPES, PET_TYPE_LABELS } from '../../../app/data/pet_needs'
import type { ReadinessConfig, ReadinessDashboard, PetEntry, PetType } from '../../../types/readiness'
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryKind,
  InventoryItemSlim,
  InventoryListFilters,
  MeasurementSystem,
  ResourceType,
} from '../../../types/inventory'
import {
  SCENARIOS,
  SCENARIO_LABELS,
  type Scenario,
  type ScenarioPlanSlim,
} from '../../../types/scenarios'

/**
 * Self-Reliance Suite — Preparedness.
 *
 * One page, three tabs (data → assessment → response):
 *   • Inventory — the unified supplies/gear catalog moved here from the former
 *     standalone /inventory list page: filter sidebar, card grid, pagination,
 *     expiring/low-stock badges. "Add item" → /inventory/new; cards →
 *     /inventory/:id. This is the canonical inventory_items list — the same
 *     rows Supply Readiness sums and Scenario Plan steps cross-link.
 *   • Supply Readiness — the Phase 2 days-of-supply calculator: three
 *     per-resource cards (water / food / power) with days-of-supply, status
 *     pill, and gap, each carrying the CITED §5.1.1 "source:" tooltip; an
 *     expiry-warning panel; and a household-config form that PATCHes the
 *     existing /api/system/settings KV endpoint (one key per request, like the
 *     units toggle) then router.reload()s. Water is shown/entered in the user's
 *     measurement system via util/units.ts; food (kcal) and power (Wh) are
 *     system-agnostic. Stores no new stock — it reads Inventory.
 *   • Scenario Plans — the Phase 3 per-scenario checklist list (grouped by
 *     scenario, step tallies, "New plan" action). Clicking a plan opens
 *     /plans/:id; the detail/create pages link back here to ?tab=plans.
 *
 * The active tab comes from the server-resolved `tab` prop (driven by the
 * `?tab=inventory|supply|plans` query param, default inventory). Per-tab
 * loading: the server only sends the active tab's dataset, so each tab's prop
 * is optional. Switching tabs is an Inertia GET to /readiness?tab=X — when on
 * the inventory tab the filter/page params ride alongside ?tab=inventory so the
 * list stays deep-linkable.
 *
 * The units toggle lives in the page header so it applies across the Inventory
 * and Supply Readiness tabs (both display base-unit values in the user's
 * system). It PATCHes the units KV key then reloads, re-rendering whichever tab
 * is active in the new system.
 */

type ReadinessTab = 'inventory' | 'supply' | 'plans'

interface Pagination {
  total: number
  per_page: number
  current_page: number
  last_page: number
}

interface Enums {
  scenarios: { value: Scenario; label: string }[]
  categories: { value: InventoryCategory; label: string }[]
  kinds: InventoryKind[]
  conditions: InventoryCondition[]
  resource_types: ResourceType[]
  resource_base_units: Record<ResourceType, string>
}

interface PageProps {
  tab: ReadinessTab
  measurement_system: MeasurementSystem
  enums: Enums
  // Only the active tab's dataset is sent by the server, so each is optional.
  inventoryItems?: InventoryItemSlim[]
  pagination?: Pagination
  inventoryFilters?: InventoryListFilters
  /** Distinct known locations (inventory tab only) — powers the location filter. */
  locations?: string[]
  dashboard?: ReadinessDashboard
  plans?: ScenarioPlanSlim[]
}

/** List-tab default window for the "Expiring soon" card badge. */
const EXPIRING_SOON_DAYS = 30

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

/**
 * Per-status presentation, all on the desert palette (no generic Tailwind
 * green/yellow/red): a chip className, the accent-strip/progress-bar background,
 * and the status-dot color. `dotClass` is a bg-* utility so the dot tracks the
 * chip's hue.
 */
const STATUS_PILL: Record<
  ReadinessStatus,
  { label: string; className: string; barClass: string; dotClass: string }
> = {
  green: {
    label: 'On target',
    className: 'bg-desert-olive/10 text-desert-olive-dark border-desert-olive/30',
    barClass: 'bg-desert-olive',
    dotClass: 'bg-desert-olive',
  },
  yellow: {
    label: 'Building',
    className: 'bg-desert-orange/10 text-desert-orange-dark border-desert-orange/30',
    barClass: 'bg-desert-orange',
    dotClass: 'bg-desert-orange',
  },
  red: {
    label: 'Low',
    className: 'bg-desert-red/10 text-desert-red-dark border-desert-red/30',
    barClass: 'bg-desert-red',
    dotClass: 'bg-desert-red',
  },
  unset: {
    label: 'Not tracked',
    className: 'bg-desert-stone/10 text-desert-stone-dark border-desert-stone/30',
    barClass: 'bg-desert-stone-lighter',
    dotClass: 'bg-desert-stone-light',
  },
}

const RESOURCE_META: Record<
  ReadinessResource,
  { label: string; icon: React.ReactNode }
> = {
  water: { label: 'Water', icon: <IconDroplet size={20} /> },
  food: { label: 'Food', icon: <IconToolsKitchen2 size={20} /> },
  power: { label: 'Power', icon: <IconBolt size={20} /> },
}

/** Shared elevated-card surface for the Supply Readiness tab (card + form). */
const CARD_SURFACE =
  'rounded-2xl border border-desert-stone-lighter/60 bg-desert-white ' +
  'shadow-[0_1px_2px_rgba(66,68,32,0.04),0_8px_24px_-12px_rgba(66,68,32,0.12)]'

export default function ReadinessIndex(props: PageProps) {
  const { tab, measurement_system: system } = props
  const [savingSystem, setSavingSystem] = useState(false)

  /**
   * Switch tabs via an Inertia GET that updates `?tab`. Inventory carries its
   * current filter/page params so the deep-link survives; supply/plans need no
   * extra params. preserveScroll avoids a jump; the server supplies only the
   * destination tab's dataset.
   */
  const goTo = (next: ReadinessTab) => {
    if (next === tab) return
    const params: Record<string, string | number | boolean> =
      next === 'inventory' ? buildInventoryQuery(props.inventoryFilters) : {}
    params.tab = next
    router.get('/readiness', params, { preserveScroll: true })
  }

  /**
   * Persist the units preference via the existing /api/system/settings KV
   * endpoint, then reload so every base-unit value re-displays in the new
   * system. Switching is lossless (values are stored in base units). The reload
   * preserves the current ?tab + inventory filters because router.reload()
   * re-issues the same URL.
   */
  const setSystem = async (next: MeasurementSystem) => {
    if (next === system || savingSystem) return
    setSavingSystem(true)
    try {
      const res = await fetch('/api/system/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ key: 'inventory.measurementSystem', value: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // onFinish fires on both success and failure of the visit, so the toggle
      // never stays locked after a same-component reload.
      router.reload({ onFinish: () => setSavingSystem(false) })
    } catch {
      setSavingSystem(false)
    }
  }

  return (
    <AppLayout>
      <Head title="Preparedness" />

      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-desert-green flex items-center gap-2">
              <IconShieldCheck size={32} /> Preparedness
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Your supplies, the days-of-supply they buy you against a target, and checkable plans
              for the situations you prepare for.
            </p>
          </div>

          {/* Units toggle lives in the header so it applies across Inventory +
              Supply Readiness. It's only meaningful on those two tabs. */}
          {tab !== 'plans' && (
            <UnitsToggle system={system} disabled={savingSystem} onChange={setSystem} />
          )}
        </header>

        <TabBar active={tab} onChange={goTo} />

        {tab === 'inventory' && (
          <InventoryTab
            items={props.inventoryItems ?? []}
            pagination={props.pagination}
            filters={props.inventoryFilters ?? {}}
            enums={props.enums}
            locations={props.locations ?? []}
            system={system}
          />
        )}
        {tab === 'supply' && props.dashboard && (
          <SupplyReadinessTab dashboard={props.dashboard} />
        )}
        {tab === 'plans' && <ScenarioPlansTab plans={props.plans ?? []} />}
      </div>
    </AppLayout>
  )
}

/** The three-tab selector. Plain buttons (StyledButton renders type="button"). */
function TabBar({
  active,
  onChange,
}: {
  active: ReadinessTab
  onChange: (tab: ReadinessTab) => void
}) {
  const tabs: { id: ReadinessTab; label: string; icon: React.ReactNode }[] = [
    { id: 'inventory', label: 'Inventory', icon: <IconClipboardList size={18} /> },
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

// ─── Inventory tab ────────────────────────────────────────────────────────────

/**
 * Inventory list (moved here from the former standalone /inventory page). Filter
 * rail + card grid + pagination, all driven by the server-supplied filters. The
 * filter/pager controls issue Inertia GETs to /readiness?tab=inventory so the
 * list stays in-tab and deep-linkable. The units toggle lives in the page
 * header (shared with Supply Readiness), not here.
 */
function InventoryTab({
  items,
  pagination,
  filters,
  enums,
  locations,
}: {
  items: InventoryItemSlim[]
  pagination?: Pagination
  filters: InventoryListFilters
  enums: Enums
  locations: string[]
  system: MeasurementSystem
}) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <p className="text-sm text-gray-600">
          Track your supplies, gear, and resources for self-reliance. Map water, food, and power
          items to feed the Supply Readiness calculator.
        </p>
        <Link href="/inventory/new">
          <StyledButton variant="primary" icon="IconPlus">
            Add item
          </StyledButton>
        </Link>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <InventoryFilters
          filters={filters}
          enums={{ categories: enums.categories, kinds: enums.kinds, conditions: enums.conditions }}
          locations={locations}
          total={pagination?.total ?? items.length}
        />
        <div className="flex-1">
          {items.length === 0 ? (
            <InventoryEmptyState filters={filters} />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map((item) => (
                  <InventoryCard key={item.id} item={item} expiringWithinDays={EXPIRING_SOON_DAYS} />
                ))}
              </div>
              {pagination && pagination.last_page > 1 && (
                <Pager pagination={pagination} filters={filters} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function UnitsToggle({
  system,
  disabled,
  onChange,
}: {
  system: MeasurementSystem
  disabled: boolean
  onChange: (system: MeasurementSystem) => void
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white p-0.5 text-sm">
      <IconScale size={16} className="ml-1.5 text-gray-400" aria-hidden="true" />
      <ToggleButton active={system === 'us'} disabled={disabled} onClick={() => onChange('us')}>
        Imperial / US
      </ToggleButton>
      <ToggleButton
        active={system === 'metric'}
        disabled={disabled}
        onClick={() => onChange('metric')}
      >
        Metric
      </ToggleButton>
    </div>
  )
}

function ToggleButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-50',
        active ? 'bg-desert-green text-white' : 'text-gray-600 hover:bg-gray-100',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function InventoryEmptyState({ filters }: { filters: InventoryListFilters }) {
  const filtered =
    !!filters.category ||
    !!filters.location ||
    !!filters.search ||
    filters.expiring_within_days !== undefined ||
    filters.low_stock === true

  if (filtered) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-600">
        <IconClipboardList size={48} className="mx-auto text-gray-300 mb-3" />
        <p className="font-medium mb-1">No items match these filters</p>
        <p className="text-sm">Try clearing one or more filters from the sidebar.</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-600">
      <IconClipboardList size={48} className="mx-auto text-gray-300 mb-3" />
      <p className="font-medium mb-1">Inventory is empty</p>
      <p className="text-sm">
        Use <strong>Add item</strong> above to start cataloging your supplies and gear.
      </p>
    </div>
  )
}

function Pager({
  pagination,
  filters,
}: {
  pagination: Pagination
  filters: InventoryListFilters
}) {
  const { current_page: current, last_page: last } = pagination

  const goTo = (page: number) => {
    const target = Math.min(Math.max(1, page), last)
    if (target === current) return
    router.get(
      '/readiness',
      { ...buildInventoryQuery(filters), tab: 'inventory', page: target },
      { preserveScroll: true }
    )
  }

  const tokens = pageList(current, last)

  return (
    <nav className="mt-6 flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
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

/**
 * Flatten the inventory filters into a clean scalar query object (drop
 * empty/false params) so they can ride alongside ?tab=inventory on tab switches
 * and pager clicks.
 */
function buildInventoryQuery(
  filters: InventoryListFilters | undefined
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!filters) return out
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    out[k] = v as string | number | boolean
  }
  return out
}

// ─── Supply Readiness tab ─────────────────────────────────────────────────────

function SupplyReadinessTab({ dashboard }: { dashboard: ReadinessDashboard }) {
  const { expiryWarnings, measurementSystem } = dashboard
  const [sourcesOpen, setSourcesOpen] = useState(false)

  // Live config — seeded from the server-computed dashboard.config; updated as
  // the user types in ConfigForm (all values in BASE units, matching ReadinessConfig).
  const [liveConfig, setLiveConfig] = useState(dashboard.config)

  // Mirror the server's readiness_service.ts compute() mapping exactly:
  //   people = adults + children (both full persons, no discount — §5.1.1)
  //   water:  computeResourceReadiness('water', haveBase, people, needs.water, petWaterPerDay, horizon)
  //   food:   computeResourceReadiness('food',  haveBase, people, needs.food,  petFoodPerDay,  horizon)
  //   power:  computeResourceReadiness('power', haveBase, 1, powerPerDay, 0, horizon)
  //             ↑ people=1 + load-as-perPersonNeed, matching the server's flat-total semantics
  //
  // haveBase comes from the server-computed dashboard.resources (the DB sum
  // of contributing inventory rows); only the config inputs are live.
  const haveBase = (res: ReadinessResource) =>
    dashboard.resources.find((r) => r.resource === res)?.haveBase ?? 0

  const people = liveConfig.adults + liveConfig.children
  const horizon = liveConfig.targetHorizonDays

  // Total daily pet water (L) + food (kcal) from the typed pets list, in base
  // units. These feed the existing per-resource pet term and drive the per-card
  // pet-load readout below. Mirrors the server's effectivePetTotals.
  const petLoad = computePetLoad(liveConfig.pets, PET_NEEDS)

  const liveResources: ResourceReadiness[] = [
    computeResourceReadiness('water', haveBase('water'), people, liveConfig.needs.water, petLoad.waterL, horizon),
    computeResourceReadiness('food',  haveBase('food'),  people, liveConfig.needs.food,  petLoad.kcal,   horizon),
    computeResourceReadiness('power', haveBase('power'), 1,      liveConfig.powerPerDay, 0,              horizon),
  ]

  // Per-resource pet-load readout inputs (water + food only). Each card shows the
  // pet add to the daily need, its person-equivalent, and days with vs. without
  // pets — but only when there are pets on hand for that resource.
  const petReadout: Partial<Record<ReadinessResource, PetReadout>> = {
    water:
      petLoad.waterL > 0
        ? {
            petTotalBase: petLoad.waterL,
            personEquivalent: petPersonEquivalent(petLoad.waterL, liveConfig.needs.water),
            daysWithout: daysWithoutPets(haveBase('water'), people, liveConfig.needs.water),
          }
        : undefined,
    food:
      petLoad.kcal > 0
        ? {
            petTotalBase: petLoad.kcal,
            personEquivalent: petPersonEquivalent(petLoad.kcal, liveConfig.needs.food),
            daysWithout: daysWithoutPets(haveBase('food'), people, liveConfig.needs.food),
          }
        : undefined,
  }

  return (
    <>
      <p className="text-sm text-gray-600 mb-4">
        How many days of water, food, and power you have on hand against a {horizon}-day
        target, computed from your Inventory. Every figure cites its source.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        {liveResources.map((r) => (
          <ResourceCard
            key={r.resource}
            readiness={r}
            system={measurementSystem}
            petReadout={petReadout[r.resource]}
            foodSource={r.resource === 'food' ? dashboard.foodSource : undefined}
            grocyCoverage={r.resource === 'food' ? dashboard.grocyCoverage : undefined}
            grocyConfigured={r.resource === 'food' ? dashboard.grocyConfigured : undefined}
          />
        ))}
      </div>

      <ExpiryPanel warnings={expiryWarnings} horizon={horizon} system={measurementSystem} />

      <ConfigForm dashboard={dashboard} onLiveChange={setLiveConfig} />

      {/* Non-intrusive provenance link — the full cited rationale lives behind it
          so it never clutters the dashboard. */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setSourcesOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-desert-green hover:underline"
        >
          <IconInfoCircle size={16} />
          Sources &amp; methodology
        </button>
      </div>

      <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </>
  )
}

/** A cited source the modal links out to. */
interface SourceLink {
  label: string
  url: string
}

/**
 * Consolidated provenance for every readiness figure, drawn from spec §5.1.1
 * and the per-figure tooltips already on this page (SOURCE_NOTES / HORIZON_SOURCE
 * / PET_SOURCE). Each entry restates the rationale and links its real sources —
 * no fabricated citations.
 */
interface SourceEntry {
  title: string
  icon: React.ReactNode
  body: string
  links: SourceLink[]
}

const SOURCE_ENTRIES: SourceEntry[] = [
  {
    title: 'Water — 1 US gal/person/day',
    icon: <IconDroplet size={18} />,
    body:
      '1 US gallon (3.79 L) per person per day for drinking and sanitation. Every person counts ' +
      'as a full person — children are not discounted. FEMA, Ready.gov, and the CDC note children, ' +
      'nursing mothers, and the ill need more, and needs can double in extreme heat.',
    links: [
      { label: 'Ready.gov/water', url: 'https://www.ready.gov/water' },
      {
        label: 'FEMA "Food and Water in an Emergency" (FA-321)',
        url: 'https://www.fema.gov/pdf/library/f&web.pdf',
      },
      {
        label: 'CDC emergency water',
        url: 'https://www.cdc.gov/healthywater/emergency/drinking/creating-storing-emergency-water-supply.html',
      },
    ],
  },
  {
    title: 'Food — 2,000 kcal/person/day',
    icon: <IconToolsKitchen2 size={18} />,
    body:
      '2,000 kcal per person per day as the generic default (the FDA Nutrition Facts general ' +
      'reference). Real needs span 1,000–3,200 kcal by age, sex, and activity, so adjust the ' +
      'per-person value to your household (USDA/HHS Dietary Guidelines, Appendix 2).',
    links: [
      {
        label: 'FDA Nutrition Facts label',
        url: 'https://www.fda.gov/food/nutrition-facts-label',
      },
      { label: 'dietaryguidelines.gov', url: 'https://www.dietaryguidelines.gov' },
    ],
  },
  {
    title: 'Supply horizon — 14 days / 3 days',
    icon: <IconShieldCheck size={18} />,
    body:
      '14 days for sheltering at home; a 3-day floor for evacuation. Ready.gov itself says only ' +
      '"several days," so the day counts are cited to the Red Cross and FEMA.',
    links: [
      {
        label: 'American Red Cross survival-kit list',
        url: 'https://www.redcross.org/get-help/how-to-prepare-for-emergencies/survival-kit-supplies.html',
      },
      {
        label: 'FEMA "Food and Water in an Emergency" (FA-321)',
        url: 'https://www.fema.gov/pdf/library/f&web.pdf',
      },
    ],
  },
  {
    title: 'Pets — your own daily intake',
    icon: <IconClipboardList size={18} />,
    body:
      'No authoritative per-pet gallon or calorie figure exists; primary sources give durations ' +
      'only (AVMA: 3–7 days of food, 7+ days of water). Enter your pets’ normal combined daily ' +
      'water and food and the calculator multiplies by the horizon.',
    links: [
      { label: 'Ready.gov/pets', url: 'https://www.ready.gov/pets' },
      {
        label: 'AVMA pets-and-disasters',
        url: 'https://www.avma.org/resources-tools/pet-owners/emergencycare/pets-and-disasters',
      },
    ],
  },
  {
    title: 'Power — user-entered load',
    icon: <IconBolt size={18} />,
    body:
      'No universal per-person watt-hour standard exists — emergency power is entirely ' +
      'device-dependent. Enter your own daily Wh need; 0 leaves power untracked.',
    links: [],
  },
]

/**
 * "Why these numbers?" modal — the full, scannable provenance for every readiness
 * figure, hidden behind the bottom-of-tab link so it stays out of the way until
 * asked for. Matches the local Headless UI Dialog pattern (WorkshopRightsModal).
 */
function SourcesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50" />
      <div className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <DialogPanel className="my-8 max-w-2xl w-full rounded-lg bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-3 mb-1">
            <DialogTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <IconInfoCircle size={22} className="text-desert-green shrink-0" />
              Why these numbers? — Sources
            </DialogTitle>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <IconX size={18} />
            </button>
          </div>

          <p className="text-sm text-gray-500 mb-5">
            Every default in this calculator is grounded in an authoritative source — none are
            guessed. Adjust any figure to your household in the form above.
          </p>

          <div className="space-y-5">
            {SOURCE_ENTRIES.map((entry) => (
              <section key={entry.title}>
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <span className="text-desert-green">{entry.icon}</span>
                  {entry.title}
                </h3>
                <p className="mt-1 text-sm text-gray-600">{entry.body}</p>
                {entry.links.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {entry.links.map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-desert-green hover:underline"
                        >
                          {link.label}
                          <IconExternalLink size={12} />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <StyledButton variant="primary" onClick={onClose}>
              Close
            </StyledButton>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
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

/**
 * Per-resource pet-load readout inputs (water + food only). All amounts are in
 * BASE units; the card converts to the display unit. Supplied only when the
 * household has pets contributing to this resource.
 */
interface PetReadout {
  /** Total daily pet draw for this resource, base units (water L / food kcal). */
  petTotalBase: number
  /** The pet draw expressed as extra "people" at the per-person need. */
  personEquivalent: number
  /** Days of supply WITHOUT the pet load, for the "(Y without pets)" note. */
  daysWithout: number | null
}

function ResourceCard({
  readiness,
  system,
  petReadout,
  foodSource,
  grocyCoverage,
  grocyConfigured,
}: {
  readiness: ResourceReadiness
  system: MeasurementSystem
  petReadout?: PetReadout
  foodSource?: 'grocy' | 'inventory'
  grocyCoverage?: { covered: number; total: number }
  grocyConfigured?: boolean
}) {
  const meta = RESOURCE_META[readiness.resource]
  const pill = STATUS_PILL[readiness.status]
  const unitLabel = displayUnitLabel(readiness.resource, system)
  const haveDisplay = round2(fromBase(readiness.resource, readiness.haveBase, system))
  const gapDisplay = round2(fromBase(readiness.resource, readiness.gapBase, system))
  const unset = readiness.status === 'unset'

  // Pet readout amount in the display unit; kcal/Wh are system-agnostic so this
  // is an identity for food. Only shown when petReadout is supplied (pets > 0).
  const petAddDisplay = petReadout
    ? round2(fromBase(readiness.resource, petReadout.petTotalBase, system))
    : 0

  // Records-against-target progress for the bar (capped at 100%); null days → 0.
  const pct =
    readiness.days === null || readiness.targetDays <= 0
      ? 0
      : Math.min(100, Math.round((readiness.days / readiness.targetDays) * 100))

  return (
    <div className={`group relative flex flex-col overflow-hidden ${CARD_SURFACE}`}>
      {/* Status accent strip */}
      <div className={`h-1 w-full ${pill.barClass}`} />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-desert-green-dark">
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                unset ? 'bg-desert-stone/10 text-desert-stone-dark' : 'bg-desert-green/10 text-desert-green'
              }`}
            >
              {meta.icon}
            </span>
            <span className="flex items-center gap-1.5">
              {meta.label}
              <InfoTooltip text={SOURCE_NOTES[readiness.resource]} />
            </span>
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${pill.className}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${pill.dotClass}`} />
            {pill.label}
          </span>
        </div>

        {unset ? (
          <p className="mt-6 flex-1 text-sm leading-relaxed text-desert-stone-dark">
            Set a daily {meta.label.toLowerCase()} need below to start tracking this.
          </p>
        ) : (
          <>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-5xl font-bold leading-none tracking-tight text-desert-green">
                {readiness.days === null ? '—' : round1(readiness.days)}
              </span>
              <span className="text-sm font-medium text-desert-stone-dark">days</span>
            </div>
            <p className="mt-1.5 text-xs text-desert-stone">
              of a {readiness.targetDays}-day target
              {petReadout && petReadout.daysWithout !== null && (
                <>
                  {' '}
                  · <span className="text-desert-stone-dark">{round1(petReadout.daysWithout)} without pets</span>
                </>
              )}
            </p>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-desert-sand">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pill.barClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {readiness.resource === 'food' && grocyConfigured && (
              <p className="mt-3 text-xs text-desert-stone">
                {foodSource === 'grocy' && grocyCoverage
                  ? `From Grocy · ${grocyCoverage.covered} of ${grocyCoverage.total} items have calorie data`
                  : 'Showing local inventory (Grocy unreachable)'}
              </p>
            )}

            <dl className="mt-4 flex-1 space-y-2 border-t border-desert-stone-lighter/40 pt-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-desert-stone-dark">On hand</dt>
                <dd className="font-semibold tabular-nums text-desert-green-dark">
                  {haveDisplay} <span className="text-xs font-normal text-desert-stone">{unitLabel}</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-desert-stone-dark">Need / day</dt>
                <dd className="font-semibold tabular-nums text-desert-green-dark">
                  {round2(fromBase(readiness.resource, readiness.dailyNeed, system))}{' '}
                  <span className="text-xs font-normal text-desert-stone">{unitLabel}/day</span>
                </dd>
              </div>
            </dl>

            {petReadout && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-desert-sand/70 px-2.5 py-1.5 text-xs text-desert-tan-dark">
                <IconPaw size={13} className="shrink-0 text-desert-green" />
                Pets add {petAddDisplay} {unitLabel}/day{' '}
                <span className="text-desert-stone-light">·</span> ≈ {round1(petReadout.personEquivalent)} people
              </p>
            )}

            {readiness.gapBase > 0 && (
              <p className="mt-3 pt-1 text-sm text-desert-stone-dark">
                <span className="font-semibold text-desert-orange-dark">
                  {gapDisplay} {unitLabel}
                </span>{' '}
                short of {readiness.targetDays} days.
              </p>
            )}
          </>
        )}
      </div>
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
      <div className={`${CARD_SURFACE} mb-6 p-4 text-sm text-desert-stone-dark`}>
        No contributing stock expires before the {horizon}-day window.
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-2xl border border-desert-orange/30 bg-desert-orange/5 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-desert-orange-dark">
        <IconAlertTriangle size={18} />
        {warnings.length} item{warnings.length === 1 ? '' : 's'} expire before day {horizon}
      </h2>
      <p className="mt-1 text-xs text-desert-orange-dark/80">
        These are still counted in your on-hand totals — they just won&apos;t last the full window.
      </p>
      <ul className="mt-3 divide-y divide-desert-orange/15">
        {warnings.map((w) => {
          const unitLabel = displayUnitLabel(w.resource, system)
          const amount = round2(fromBase(w.resource, w.amountBase, system))
          return (
            <li
              key={w.id}
              className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm"
            >
              <Link
                href={`/inventory/${w.id}`}
                className="font-semibold text-desert-green hover:underline"
              >
                {w.name}
              </Link>
              <span className="text-desert-orange-dark">
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

function ConfigForm({
  dashboard,
  onLiveChange,
}: {
  dashboard: ReadinessDashboard
  onLiveChange: (config: ReadinessConfig) => void
}) {
  const system = dashboard.measurementSystem
  const c = dashboard.config

  // Water needs are stored in base units (L); show/edit them in the display unit.
  const [form, setForm] = useState({
    adults: String(c.adults),
    children: String(c.children),
    targetHorizonDays: String(c.targetHorizonDays),
    waterPerPerson: String(round3(fromBase('water', c.needs.water, system))),
    foodPerPerson: String(round1(c.needs.food)),
    powerPerDay: String(round1(c.powerPerDay)),
  })
  // Typed pets, kept in their own state (a structured list, not form strings).
  // Seeded from config.pets; legacy installs (no typed pets, but a saved
  // petWaterPerDay/petFoodPerDay total) start empty here and the service's
  // legacy fallback keeps surfacing their old totals until the user adds a pet.
  const [pets, setPets] = useState<PetEntry[]>(c.pets)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  /**
   * Convert the current form strings + pets list to a ReadinessConfig (all base
   * units) and fire onLiveChange so SupplyReadinessTab can immediately recompute
   * the cards. Water display-unit values are converted back to L (toBase);
   * food/power are system-agnostic. The pets list drives pet water/food via
   * computePetLoad on the receiving side, so the legacy petWaterPerDay/
   * petFoodPerDay are carried through unchanged (still read as a fallback). This
   * mirrors the onSave base-unit math but is side-effect-free.
   */
  const fireLiveChange = (next: typeof form, nextPets: PetEntry[]) => {
    onLiveChange({
      adults: toNonNegativeInt(next.adults),
      children: toNonNegativeInt(next.children),
      targetHorizonDays: clampHorizon(toNonNegativeInt(next.targetHorizonDays)),
      needs: {
        water: toBase('water', toNonNegativeNumber(next.waterPerPerson), system),
        food: toNonNegativeNumber(next.foodPerPerson),
        power: 0, // power need lives in powerPerDay (no per-person standard)
      },
      pets: nextPets,
      petWaterPerDay: c.petWaterPerDay,
      petFoodPerDay: c.petFoodPerDay,
      powerPerDay: toNonNegativeNumber(next.powerPerDay),
    })
  }

  // Editing updates the form AND fires the live recompute, so the cards update
  // on every keystroke. The "Calculate" button (onCalculate) re-runs the same
  // recompute on demand — both paths share fireLiveChange.
  const set = <K extends keyof typeof form>(key: K, value: string) => {
    // Compute next, update the form, then fire the recompute in the handler —
    // NOT inside the setForm updater. An updater must stay pure; calling the
    // parent's setLiveConfig from within it warns ("cannot update a component
    // while rendering another") and double-fires under StrictMode. Mirrors
    // updatePets below.
    const next = { ...form, [key]: value }
    setForm(next)
    fireLiveChange(next, pets)
  }

  /**
   * Apply a pets-list change: update the pets state AND fire the live recompute
   * so the cards + per-resource pet readout track the edit on every change.
   */
  const updatePets = (nextPets: PetEntry[]) => {
    setPets(nextPets)
    fireLiveChange(form, nextPets)
  }

  /**
   * Recompute all readiness cards (water, food, power) from the current form +
   * pets by pushing them into the parent's liveConfig. Wired to the "Calculate"
   * button — a redundant on-demand path now that editing recomputes live.
   */
  const onCalculate = () => fireLiveChange(form, pets)

  const waterUnit = displayUnitLabel('water', system)

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)

    // Build the base-unit needs JSON. food/power are system-agnostic; water
    // converts from the display unit back to liters.
    // needs.power is always 0 — no per-person standard exists; the user's
    // daily Wh load lives in readiness.powerPerDay instead.
    const needs = {
      water: toBase('water', toNonNegativeNumber(form.waterPerPerson), system),
      food: toNonNegativeNumber(form.foodPerPerson),
      power: 0,
    }

    // Pets persist as the readiness.pets JSON array (typed entries); the manual
    // petWaterPerDay/petFoodPerDay totals are no longer written — the service
    // still reads them as a fallback for installs that predate typed pets.
    const updates: { key: string; value: string }[] = [
      { key: 'readiness.householdAdults', value: String(toNonNegativeInt(form.adults)) },
      { key: 'readiness.householdChildren', value: String(toNonNegativeInt(form.children)) },
      {
        key: 'readiness.targetHorizonDays',
        value: String(clampHorizon(toNonNegativeInt(form.targetHorizonDays))),
      },
      { key: 'readiness.needs', value: JSON.stringify(needs) },
      { key: 'readiness.pets', value: JSON.stringify(normalizePetsForSave(pets)) },
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
    <form onSubmit={onSave} className={`overflow-hidden ${CARD_SURFACE}`}>
      <div className="border-b border-desert-stone-lighter/40 bg-gradient-to-b from-desert-sand/50 to-transparent px-6 py-4">
        <h2 className="text-lg font-semibold tracking-tight text-desert-green-dark">Household</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-desert-stone-dark">
          Children count as full persons for water and food — needs are never discounted by age
          (FEMA/Ready.gov). The cards above show your household total; the rates below are the
          per-person standards they multiply.
        </p>
      </div>

      <div className="space-y-7 px-6 py-6">
        {/* Who's in the household + the target window. */}
        <fieldset>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-desert-stone">
            Who &amp; how long
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberField label="Adults" value={form.adults} onChange={(v) => set('adults', v)} min={0} step={1} />
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
          </div>
        </fieldset>

        <PetsField pets={pets} system={system} onChange={updatePets} />

        {/* Per-person daily needs. */}
        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-desert-stone">
            Per-person daily needs
          </legend>
          <p className="mb-3 text-xs text-desert-stone-dark">
            What one person uses per day (FEMA/Ready.gov defaults). Your household total is computed
            on the cards above.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-desert-stone-lighter/40 bg-desert-sand/30 px-6 py-4">
        {/* StyledButton renders type="button", so submission is wired via
            onClick rather than the form's onSubmit. The cards now recompute live
            as the user edits; "Calculate" re-runs that recompute on demand and
            "Save" persists + reloads. */}
        <StyledButton variant="primary" icon="IconCalculator" onClick={onCalculate}>
          Calculate
        </StyledButton>
        <StyledButton
          variant="secondary"
          icon="IconDeviceFloppy"
          loading={saving}
          disabled={saving}
          onClick={() => onSave()}
        >
          Save
        </StyledButton>
        {message && (
          <span
            className={
              message.kind === 'ok' ? 'text-sm text-desert-olive-dark' : 'text-sm text-desert-red-dark'
            }
          >
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
    <div className="flex h-full flex-col">
      <label className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-desert-stone-dark">
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
        className="mt-auto block w-full rounded-lg border border-desert-stone-lighter bg-white px-3 py-2 text-sm text-desert-green-darker transition focus:border-desert-green focus:outline-none focus:ring-2 focus:ring-desert-green/20"
      />
    </div>
  )
}

/**
 * Typed-pets editor. Each row is a count + a species dropdown; selecting "Other"
 * reveals per-pet water + calorie inputs (no built-in estimate for that type).
 * The first row always renders (count 0 when there are no pets yet); "+ add pet"
 * appends another removable row. The per-pet estimate behind each typed species
 * comes from PET_NEEDS — the calculator multiplies it by the count. Water is
 * shown in the user's display unit; food (kcal) is system-agnostic.
 */
function PetsField({
  pets,
  system,
  onChange,
}: {
  pets: PetEntry[]
  system: MeasurementSystem
  onChange: (pets: PetEntry[]) => void
}) {
  const waterUnit = displayUnitLabel('water', system)
  // Always show at least one row so the household always has a pets control; an
  // empty/zero-count first row contributes nothing to the calculator.
  const rows: PetEntry[] = pets.length > 0 ? pets : [{ type: 'dog', count: 0 }]

  const updateRow = (index: number, patch: Partial<PetEntry>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    onChange(next)
  }

  const changeType = (index: number, type: PetType) => {
    // Selecting "Other" seeds blank per-pet figures; any other type drops them
    // (PET_NEEDS supplies the per-pet estimate).
    const patch: Partial<PetEntry> =
      type === 'other' ? { type, waterL: 0, kcal: 0 } : { type, waterL: undefined, kcal: undefined }
    updateRow(index, patch)
  }

  const addRow = () => onChange([...rows, { type: 'dog', count: 0 }])
  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    onChange(next)
  }

  const petInput =
    'block rounded-lg border border-desert-stone-lighter bg-white px-3 py-1.5 text-sm text-desert-green-darker transition focus:border-desert-green focus:outline-none focus:ring-2 focus:ring-desert-green/20'
  const petLabel = 'mb-1 text-[11px] font-semibold uppercase tracking-wide text-desert-stone'

  return (
    <fieldset className="rounded-xl border border-desert-stone-lighter/50 bg-desert-sand/30 p-4">
      <legend className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-desert-stone">
        <IconPaw size={14} className="text-desert-green" />
        Pets
        <InfoTooltip text={PET_SOURCE} />
      </legend>
      <p className="mb-3 text-xs text-desert-stone-dark">
        Typical-adult estimates; needs vary with weight.
      </p>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-desert-stone-lighter/50 bg-white px-3 py-2.5"
          >
            <div className="flex flex-col">
              <label className={petLabel}>Count</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={String(row.count)}
                onChange={(e) => updateRow(i, { count: toNonNegativeInt(e.target.value) })}
                className={`${petInput} w-20`}
              />
            </div>

            <div className="flex flex-col">
              <label className={petLabel}>Type</label>
              <select
                value={row.type}
                onChange={(e) => changeType(i, e.target.value as PetType)}
                className={petInput}
              >
                {PET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PET_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {row.type === 'other' && (
              <>
                <div className="flex flex-col">
                  <label className={petLabel}>Water/pet ({waterUnit}/day)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.1}
                    value={String(round3(fromBase('water', row.waterL ?? 0, system)))}
                    onChange={(e) =>
                      updateRow(i, {
                        waterL: toBase('water', toNonNegativeNumber(e.target.value), system),
                      })
                    }
                    className={`${petInput} w-28`}
                  />
                </div>
                <div className="flex flex-col">
                  <label className={petLabel}>Food/pet (kcal/day)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={50}
                    value={String(round1(row.kcal ?? 0))}
                    onChange={(e) => updateRow(i, { kcal: toNonNegativeNumber(e.target.value) })}
                    className={`${petInput} w-28`}
                  />
                </div>
              </>
            )}

            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove pet"
                className="ml-auto mb-0.5 inline-flex items-center rounded-lg p-2 text-desert-red transition hover:bg-desert-red/10"
              >
                <IconTrash size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-desert-green transition hover:bg-desert-green/5"
      >
        <IconPlus size={16} /> Add pet
      </button>
    </fieldset>
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

/**
 * Prepare the pets list for persistence: drop zero-count rows (a row the user
 * left empty contributes nothing) and keep per-pet waterL/kcal only for 'other'
 * (typed species read their figures from PET_NEEDS, so storing them would
 * duplicate canonical data).
 */
function normalizePetsForSave(pets: PetEntry[]): PetEntry[] {
  return pets
    .filter((p) => p.count > 0)
    .map((p) =>
      p.type === 'other'
        ? { type: p.type, count: p.count, waterL: p.waterL ?? 0, kcal: p.kcal ?? 0 }
        : { type: p.type, count: p.count }
    )
}
