import { Link } from '@inertiajs/react'
import {
  IconAlertTriangle,
  IconClock,
  IconLeaf,
  IconPackage,
  IconTool,
} from '@tabler/icons-react'
import type { InventoryItemSlim } from '../../../types/inventory'
import { CATEGORY_LABELS } from '../../../types/inventory'
import { isExpiringWithin, isLowStock } from '../../../util/units'
import { contributesToReadiness } from '../../../util/inventory'

interface InventoryCardProps {
  item: InventoryItemSlim
  /** Days-out window that counts as "expiring soon" on the list page. */
  expiringWithinDays: number
}

/**
 * One tile in the Inventory grid. Shows name, category badge, quantity + unit,
 * and location, plus status badges:
 *   • amber "Low stock"      when quantity <= restock_threshold
 *   • amber "Expiring soon"  when expiry_date is within the configured window
 *   • green "Readiness" dot  when the item contributes to the calculator
 *
 * Mirrors StlCard's link-to-detail behavior and graceful null formatting.
 */
export default function InventoryCard({ item, expiringWithinDays }: InventoryCardProps) {
  const isGear = item.kind === 'gear'
  const lowStock = !isGear && isLowStock(item.quantity, item.restock_threshold)
  const expiringSoon =
    !isGear &&
    !item.never_expires &&
    isExpiringWithin(item.expiry_date, expiringWithinDays, new Date())
  const countsTowardReadiness = contributesToReadiness(item)

  return (
    <Link
      href={`/inventory/${item.id}`}
      className={[
        'group relative flex flex-col rounded-lg border bg-surface-primary overflow-hidden',
        'shadow-sm hover:shadow-md transition-shadow p-3 gap-2',
        lowStock || expiringSoon ? 'border-amber-300 ring-1 ring-amber-200' : 'border-border-subtle',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isGear ? (
            <IconTool size={20} className="shrink-0 text-desert-stone-dark" aria-hidden="true" />
          ) : (
            <IconPackage size={20} className="shrink-0 text-desert-green" aria-hidden="true" />
          )}
          <span className="font-semibold text-sm text-text-primary truncate" title={item.name}>
            {item.name}
          </span>
        </div>
        {countsTowardReadiness && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 shrink-0"
            title="Counts toward readiness"
          >
            <IconLeaf size={11} aria-hidden="true" /> Readiness
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="inline-block rounded-full bg-desert-green-light text-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
          {CATEGORY_LABELS[item.category]}
        </span>
        {/* Kind badge — only shown for gear so consumables don't show redundant chrome */}
        {isGear && (
          <span className="inline-block rounded-full bg-desert-stone-lighter/60 text-desert-stone-dark px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            Gear
          </span>
        )}
        <span className="font-medium text-text-primary">
          {formatQuantity(item.quantity)} {item.unit}
        </span>
      </div>

      {/* Condition — relevant for gear */}
      {isGear && item.condition && (
        <div className="text-[11px] text-text-muted capitalize">
          Condition: {item.condition}
        </div>
      )}

      {/* Expiry — only for consumables that expire */}
      {!isGear && item.never_expires && (
        <div className="text-[11px] text-desert-stone italic">No expiry</div>
      )}

      {item.location && (
        <div className="text-[11px] text-text-muted truncate" title={item.location}>
          {item.location}
        </div>
      )}

      {(lowStock || expiringSoon) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {lowStock && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
              <IconAlertTriangle size={11} aria-hidden="true" /> Low stock
            </span>
          )}
          {expiringSoon && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
              <IconClock size={11} aria-hidden="true" /> Expiring soon
            </span>
          )}
        </div>
      )}
    </Link>
  )
}

/** Trim trailing zeros from a decimal quantity so "2.500" renders as "2.5", "3.000" as "3". */
function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) return String(quantity)
  return String(Number(quantity.toFixed(3)))
}
