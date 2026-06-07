import type { HttpContext } from '@adonisjs/core/http'
import KVStore from '#models/kv_store'
import { InventoryService } from '#services/inventory_service'
import {
  createInventoryItemValidator,
  listInventoryItemsValidator,
  resourceMappingValid,
  updateInventoryItemValidator,
} from '#validators/inventory'
import {
  CATEGORY_LABELS,
  INVENTORY_CATEGORIES,
  INVENTORY_CONDITIONS,
  MEASUREMENT_SYSTEMS,
  RESOURCE_BASE_UNITS,
  RESOURCE_TYPES,
  type InventoryItemDetail,
  type MeasurementSystem,
} from '../../types/inventory.js'

/**
 * Self-Reliance Suite — Inventory HTTP boundary.
 *
 * Renders two Inertia pages (list + detail/create) and a small JSON API for
 * create/update/delete. Mirrors the WorkshopController shape: index/show render
 * Inertia; store/update/destroy are JSON mutations; integer-id guards; never
 * leak exceptions to the UI.
 *
 * Inventory writes no files, so the Workshop "drive unavailable" branch is
 * omitted — the catalog is pure DB rows.
 */
export default class InventoryController {
  /**
   * GET /inventory — list page. Server-renders the filtered, paginated rows
   * plus the enum lists and the current measurement system so the sidebar and
   * resource badges don't need a separate fetch.
   */
  async index({ inertia, request }: HttpContext) {
    const filters = await request.validateUsing(listInventoryItemsValidator)
    const service = new InventoryService()
    const { items, pagination } = await service.list(filters)

    return inertia.render('inventory/index', {
      items,
      pagination,
      filters,
      enums: this.enumsForUi(),
      measurement_system: await this.measurementSystem(),
    })
  }

  /**
   * GET /inventory/new — create form. The show page doubles as create when
   * given no row (item: null).
   */
  async new({ inertia }: HttpContext) {
    return inertia.render('inventory/show', {
      item: null,
      enums: this.enumsForUi(),
      measurement_system: await this.measurementSystem(),
    })
  }

  /**
   * GET /inventory/:id — detail / edit page.
   */
  async show({ inertia, params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.notFound({ error: 'invalid id' })
    }

    const service = new InventoryService()
    const row = await service.find(id)
    if (!row) {
      return response.notFound({ error: 'Inventory item not found' })
    }

    const item: InventoryItemDetail = {
      id: row.id,
      name: row.name,
      category: row.category,
      quantity: row.quantity,
      unit: row.unit,
      location: row.location,
      notes: row.notes,
      expiry_date: row.expiry_date ? row.expiry_date.toISODate() : null,
      restock_threshold: row.restock_threshold,
      condition: row.condition,
      resource_type: row.resource_type,
      resource_contribution: row.resource_contribution,
      added_at: row.added_at?.toISO() ?? '',
      updated_at: row.updated_at?.toISO() ?? '',
    }

    return inertia.render('inventory/show', {
      item,
      enums: this.enumsForUi(),
      measurement_system: await this.measurementSystem(),
    })
  }

  /**
   * POST /api/inventory — create. resource_contribution is expected already
   * converted to the base unit by the form.
   */
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createInventoryItemValidator)

    const gate = resourceMappingValid(payload.resource_type, payload.resource_contribution)
    if (!gate.ok) {
      return response.badRequest({ error: gate.error })
    }

    const service = new InventoryService()
    const row = await service.create(payload)
    return { success: true, id: row.id }
  }

  /**
   * PATCH /api/inventory/:id — patch present fields only.
   *
   * The cross-field resource rule is checked against the EFFECTIVE post-patch
   * state: an explicit field in the payload wins, otherwise the existing row's
   * value stands — so clearing only resource_contribution on a still-mapped row
   * is correctly rejected.
   */
  async update({ params, request, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const service = new InventoryService()
    const existing = await service.find(id)
    if (!existing) return response.notFound({ error: 'Inventory item not found' })

    const payload = await request.validateUsing(updateInventoryItemValidator)

    const effectiveType =
      payload.resource_type !== undefined ? payload.resource_type : existing.resource_type
    const effectiveContribution =
      payload.resource_contribution !== undefined
        ? payload.resource_contribution
        : existing.resource_contribution

    const gate = resourceMappingValid(effectiveType, effectiveContribution)
    if (!gate.ok) {
      return response.badRequest({ error: gate.error })
    }

    await service.update(id, payload)
    return { success: true }
  }

  /**
   * DELETE /api/inventory/:id — delete a row (no file to remove).
   */
  async destroy({ params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const service = new InventoryService()
    const ok = await service.destroy(id)
    if (!ok) return response.notFound({ error: 'Inventory item not found' })
    return { success: true }
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  /** Read the measurement-system preference, defaulting to 'us'. */
  private async measurementSystem(): Promise<MeasurementSystem> {
    const raw = await KVStore.getValue('inventory.measurementSystem')
    return (MEASUREMENT_SYSTEMS as readonly string[]).includes(raw ?? '')
      ? (raw as MeasurementSystem)
      : 'us'
  }

  private enumsForUi() {
    return {
      categories: INVENTORY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
      conditions: [...INVENTORY_CONDITIONS],
      resource_types: [...RESOURCE_TYPES],
      resource_base_units: RESOURCE_BASE_UNITS,
    }
  }
}
