import { useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import InventoryCard from '~/components/inventory/InventoryCard'
import InventoryFilters from '~/components/inventory/InventoryFilters'
import StyledButton from '~/components/StyledButton'
import { IconClipboardList, IconScale } from '@tabler/icons-react'
import { pageList } from '../../../util/workshop_pagination'
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryItemSlim,
  InventoryListFilters,
  MeasurementSystem,
  ResourceType,
} from '../../../types/inventory'

/** List-page default window for the "Expiring soon" card badge. */
const EXPIRING_SOON_DAYS = 30

interface Pagination {
  total: number
  per_page: number
  current_page: number
  last_page: number
}

interface Enums {
  categories: { value: InventoryCategory; label: string }[]
  conditions: InventoryCondition[]
  resource_types: ResourceType[]
  resource_base_units: Record<ResourceType, string>
}

interface PageProps {
  items: InventoryItemSlim[]
  pagination: Pagination
  filters: InventoryListFilters
  enums: Enums
  measurement_system: MeasurementSystem
}

export default function InventoryIndex(props: PageProps) {
  const [savingSystem, setSavingSystem] = useState(false)

  // Persist the units preference via the existing /api/system/settings KV
  // endpoint, then reload so every base-unit value re-displays in the new
  // system. Switching is lossless (values are stored in base units).
  const setSystem = async (system: MeasurementSystem) => {
    if (system === props.measurement_system || savingSystem) return
    setSavingSystem(true)
    try {
      const res = await fetch('/api/system/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ key: 'inventory.measurementSystem', value: system }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // router.reload() keeps this component mounted (Inertia preserves state on
      // a same-component reload), so savingSystem must be cleared explicitly once
      // the reload settles — otherwise it stays true and the toggle locks after
      // a single switch. onFinish fires on both success and failure of the visit.
      router.reload({ onFinish: () => setSavingSystem(false) })
    } catch {
      // Leave the toggle as-is on failure; the reload simply won't fire.
      setSavingSystem(false)
    }
  }

  return (
    <AppLayout>
      <Head title="Inventory" />

      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-desert-green flex items-center gap-2">
              <IconClipboardList size={32} /> Inventory
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Track your supplies, gear, and resources for self-reliance. Map water, food,
              and power items to feed the readiness calculator.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <UnitsToggle
              system={props.measurement_system}
              disabled={savingSystem}
              onChange={setSystem}
            />
            <Link href="/inventory/new">
              <StyledButton variant="primary" icon="IconPlus">
                Add item
              </StyledButton>
            </Link>
          </div>
        </header>

        <div className="flex flex-col md:flex-row gap-4">
          <InventoryFilters
            filters={props.filters}
            enums={{ categories: props.enums.categories }}
            total={props.pagination.total}
          />
          <div className="flex-1">
            {props.items.length === 0 ? (
              <EmptyState filters={props.filters} />
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {props.items.map((item) => (
                    <InventoryCard key={item.id} item={item} expiringWithinDays={EXPIRING_SOON_DAYS} />
                  ))}
                </div>
                {props.pagination.last_page > 1 && (
                  <Pager pagination={props.pagination} filters={props.filters} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
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

function EmptyState({
  filters,
}: {
  filters: InventoryListFilters
}) {
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
    router.get('/inventory', { ...filters, page: target }, { preserveScroll: true, preserveState: true })
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
