import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import InventoryItem from '#models/inventory_item'
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryItemSlim,
  InventoryListFilters,
  ResourceType,
} from '../../types/inventory.js'

/**
 * Self-Reliance Suite — Inventory data access + business logic.
 *
 * CRUD plus filtered reads and the two Phase-2 aggregation reads
 * (sumByResource, expiringBefore). NO filesystem scanner — the catalog is the
 * source of truth, so unlike StlScannerService this class never touches disk.
 *
 * Returns plain result objects; the controller maps to the Inertia DTOs. Logs
 * via @adonisjs/core/services/logger, matching the Workshop service shape.
 */

/** Fields the controller hands the service to create a row. */
export interface CreateInventoryData {
  name: string
  category: InventoryCategory
  quantity: number
  unit: string
  location?: string | null
  notes?: string | null
  expiry_date?: Date | null
  restock_threshold?: number | null
  condition?: InventoryCondition | null
  resource_type?: ResourceType | null
  resource_contribution?: number | null
}

/** Partial patch — only present keys are written (Workshop update pattern). */
export type UpdateInventoryData = Partial<CreateInventoryData>

export interface SumByResourceResult {
  total_base: number
  rows: number
}

export class InventoryService {
  async create(data: CreateInventoryData): Promise<InventoryItem> {
    const row = new InventoryItem()
    row.name = data.name
    row.category = data.category
    row.quantity = data.quantity
    row.unit = data.unit
    row.location = data.location ?? null
    row.notes = data.notes ?? null
    row.expiry_date = toDateTime(data.expiry_date)
    row.restock_threshold = data.restock_threshold ?? null
    row.condition = data.condition ?? null
    row.resource_type = data.resource_type ?? null
    row.resource_contribution = data.resource_contribution ?? null
    await row.save()
    return row
  }

  /**
   * Patch only the fields present on `data` (a key being `undefined` means
   * "not in this payload — leave it alone"; an explicit `null` clears it).
   */
  async update(id: number, data: UpdateInventoryData): Promise<InventoryItem | null> {
    const row = await InventoryItem.find(id)
    if (!row) return null

    if (data.name !== undefined) row.name = data.name
    if (data.category !== undefined) row.category = data.category
    if (data.quantity !== undefined) row.quantity = data.quantity
    if (data.unit !== undefined) row.unit = data.unit
    if (data.location !== undefined) row.location = data.location ?? null
    if (data.notes !== undefined) row.notes = data.notes ?? null
    if (data.expiry_date !== undefined) row.expiry_date = toDateTime(data.expiry_date)
    if (data.restock_threshold !== undefined) row.restock_threshold = data.restock_threshold ?? null
    if (data.condition !== undefined) row.condition = data.condition ?? null
    if (data.resource_type !== undefined) row.resource_type = data.resource_type ?? null
    if (data.resource_contribution !== undefined)
      row.resource_contribution = data.resource_contribution ?? null

    await row.save()
    return row
  }

  async destroy(id: number): Promise<boolean> {
    const row = await InventoryItem.find(id)
    if (!row) return false
    await row.delete()
    return true
  }

  async find(id: number): Promise<InventoryItem | null> {
    return InventoryItem.find(id)
  }

  /**
   * Filtered, paginated list. Returns slim DTOs (no `notes`). Filters:
   *   • category   — exact match
   *   • location   — case-insensitive contains (whereILike)
   *   • search     — case-insensitive contains on name (name-only, per spec)
   *   • expiring_within_days — expiry_date <= today + N (non-null only)
   *   • low_stock  — quantity <= restock_threshold AND restock_threshold IS NOT NULL
   */
  async list(filters: InventoryListFilters): Promise<{
    items: InventoryItemSlim[]
    pagination: { total: number; per_page: number; current_page: number; last_page: number }
  }> {
    const page = filters.page ?? 1
    const perPage = filters.per_page ?? 48

    const query = InventoryItem.query()

    if (filters.category) query.where('category', filters.category)
    if (filters.location) query.whereILike('location', `%${filters.location}%`)
    if (filters.search) query.whereILike('name', `%${filters.search}%`)

    if (filters.expiring_within_days !== undefined) {
      const horizon = DateTime.now().plus({ days: filters.expiring_within_days }).toSQLDate()
      if (horizon) {
        query.whereNotNull('expiry_date').where('expiry_date', '<=', horizon)
      }
    }

    if (filters.low_stock === true) {
      query
        .whereNotNull('restock_threshold')
        .whereColumn('quantity', '<=', 'restock_threshold')
    }

    // Items needing attention float up: expiring soonest first (nulls last),
    // then newest. MySQL sorts NULLs first on ASC, so a secondary sort keeps
    // dated items grouped ahead without a non-portable NULLS LAST clause.
    query.orderByRaw('expiry_date IS NULL').orderBy('expiry_date', 'asc').orderBy('added_at', 'desc')

    const paginated = await query.paginate(page, perPage)

    const items: InventoryItemSlim[] = paginated.all().map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      quantity: row.quantity,
      unit: row.unit,
      location: row.location,
      expiry_date: row.expiry_date ? row.expiry_date.toISODate() : null,
      restock_threshold: row.restock_threshold,
      resource_type: row.resource_type,
      resource_contribution: row.resource_contribution,
    }))

    return {
      items,
      pagination: {
        total: paginated.total,
        per_page: paginated.perPage,
        current_page: paginated.currentPage,
        last_page: paginated.lastPage,
      },
    }
  }

  /**
   * Distinct, non-empty `location` values across the catalog, alphabetized.
   * Powers the type-to-add location combobox on the item form and the location
   * filter dropdown on the Inventory tab — both suggest known locations while
   * still allowing a brand-new free-typed value (which appears here next time).
   */
  async distinctLocations(): Promise<string[]> {
    const rows = await InventoryItem.query()
      .distinct('location')
      .whereNotNull('location')
      .whereNot('location', '')
      .orderBy('location', 'asc')

    return rows
      .map((row) => row.location)
      .filter((loc): loc is string => loc !== null && loc !== '')
  }

  /**
   * Phase 2 dependency: total base-unit amount for a resource across all
   * contributing rows. Excludes contribution <= 0 so a stray bad row can't
   * corrupt the total (the cross-field validator already blocks those on save;
   * this is defense in depth). `total_base` is in the resource's base unit.
   */
  async sumByResource(resourceType: ResourceType): Promise<SumByResourceResult> {
    const result = await InventoryItem.query()
      .where('resource_type', resourceType)
      .where('resource_contribution', '>', 0)
      .sum('resource_contribution as total')
      .count('* as rows')
      .first()

    const total = result ? Number((result.$extras as { total: unknown }).total ?? 0) : 0
    const rows = result ? Number((result.$extras as { rows: unknown }).rows ?? 0) : 0

    return {
      total_base: Number.isFinite(total) ? total : 0,
      rows: Number.isFinite(rows) ? rows : 0,
    }
  }

  /**
   * Phase 2 dependency: contributing rows whose expiry_date falls before
   * `date`. Used by the readiness dashboard to warn "X of resource Y expires
   * before the horizon." Only rows that contribute to a resource are returned.
   */
  async expiringBefore(date: DateTime): Promise<InventoryItem[]> {
    const sqlDate = date.toSQLDate()
    if (!sqlDate) {
      logger.warn('[InventoryService] expiringBefore received an invalid date')
      return []
    }
    return InventoryItem.query()
      .whereNotNull('resource_type')
      .where('resource_contribution', '>', 0)
      .whereNotNull('expiry_date')
      .where('expiry_date', '<=', sqlDate)
      .orderBy('expiry_date', 'asc')
  }
}

/** Coerce the validator's JS Date (or null/undefined) to a Luxon DateTime or null. */
function toDateTime(value: Date | null | undefined): DateTime | null {
  if (value === null || value === undefined) return null
  return DateTime.fromJSDate(value)
}
