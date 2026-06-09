/**
 * Self-Reliance Suite — Inventory shared enums and TypeScript types.
 *
 * Phase 1 of the Self-Reliance Suite (see
 * docs/superpowers/specs/2026-06-06-self-reliance-suite-design.md §4). One
 * unified catalog covers consumables, gear, and resource-mapped supplies.
 * Items are hand-curated (no filesystem scanner — unlike Workshop). A nullable
 * "resource-mapping bridge" (resource_type + resource_contribution) lets
 * selected items feed the Phase 2 readiness calculator.
 *
 * Enum arrays are the single source of truth: the DB columns are plain
 * varchars (validated at the Vine layer, not in MySQL) so the enums can grow
 * without an ALTER TABLE — exactly the stl_library.ts pattern.
 */

/**
 * Item kind — discriminates consumables (tracked by expiry/restock) from gear
 * (tracked by condition). varchar(16) in the DB; validated at the Vine layer
 * so the set can grow without an ALTER TABLE — the stl_library.ts pattern.
 */
export const INVENTORY_KINDS = ['consumable', 'gear'] as const

export type InventoryKind = (typeof INVENTORY_KINDS)[number]

export const INVENTORY_CATEGORIES = [
  'food',
  'water',
  'meds',
  'fuel',
  'batteries',
  'tools',
  'comms',
  'shelter',
  'other',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

/** Gear condition (nullable — only meaningful for durable goods). */
export const INVENTORY_CONDITIONS = ['new', 'good', 'fair', 'poor'] as const

export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number]

/**
 * Resource bridge to the Phase 2 calculator. A null resource_type means the
 * item is excluded from readiness math. Each non-null type stores its
 * resource_contribution in a fixed base unit (see RESOURCE_BASE_UNITS).
 */
export const RESOURCE_TYPES = ['water', 'food', 'power'] as const

export type ResourceType = (typeof RESOURCE_TYPES)[number]

/**
 * Measurement-system preference. Persisted as the single KV key
 * 'inventory.measurementSystem' (default 'us'). Drives display-unit conversion
 * in the inventory UI and, in Phase 2, the calculator's display defaults.
 * "us" is US customary (US gallon = 3.785411784 L), NOT UK imperial.
 */
export const MEASUREMENT_SYSTEMS = ['us', 'metric'] as const

export type MeasurementSystem = (typeof MEASUREMENT_SYSTEMS)[number]

/**
 * The internal base unit each resource_contribution is stored in. The user
 * enters/sees the value in their display unit; the form converts to base for
 * storage and back for display via util/units.ts. The calculator always
 * operates in base units, so the chosen display system never affects the math.
 *   • water → liters (L)        — SI base; clean US-gallon conversion
 *   • food  → kilocalories (kcal) — universal energy unit
 *   • power → watt-hours (Wh)     — standard battery/solar capacity
 */
export const RESOURCE_BASE_UNITS: Record<ResourceType, string> = {
  water: 'L',
  food: 'kcal',
  power: 'Wh',
}

/**
 * Human-friendly category labels for badges, filters, and empty states.
 */
export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  food: 'Food',
  water: 'Water',
  meds: 'Meds',
  fuel: 'Fuel',
  batteries: 'Batteries',
  tools: 'Tools',
  comms: 'Comms',
  shelter: 'Shelter',
  other: 'Other',
}

/**
 * Slim representation returned by the list endpoint — omits long free-text
 * fields (notes) so a large grid doesn't ship kilobytes of prose. Carries the
 * fields the card renders plus the bridge fields needed to badge an item as
 * "counts toward readiness" client-side.
 */
export interface InventoryItemSlim {
  id: number
  name: string
  category: InventoryCategory
  /** Discriminates consumable (expiry/restock-tracked) from gear (condition-tracked). */
  kind: InventoryKind
  quantity: number
  unit: string
  location: string | null
  expiry_date: string | null
  restock_threshold: number | null
  condition: InventoryCondition | null
  resource_type: ResourceType | null
  resource_contribution: number | null
  never_expires: boolean
}

/**
 * Full record returned by the detail endpoint and edit form.
 */
export interface InventoryItemDetail extends InventoryItemSlim {
  notes: string | null
  added_at: string
  updated_at: string
}

/**
 * Filter query accepted by the list endpoint.
 */
export interface InventoryListFilters {
  category?: InventoryCategory
  kind?: InventoryKind
  condition?: InventoryCondition
  location?: string
  search?: string
  expiring_within_days?: number
  low_stock?: boolean
  page?: number
  per_page?: number
}
