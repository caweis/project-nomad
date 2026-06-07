import { useEffect, useMemo, useRef, useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import { IconArrowLeft, IconTrash } from '@tabler/icons-react'
import { displayUnitLabel, fromBase, toBase } from '../../../util/units'
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryItemDetail,
  MeasurementSystem,
  ResourceType,
} from '../../../types/inventory'

interface Enums {
  categories: { value: InventoryCategory; label: string }[]
  conditions: InventoryCondition[]
  resource_types: ResourceType[]
  resource_base_units: Record<ResourceType, string>
}

interface PageProps {
  /** null in create mode. */
  item: InventoryItemDetail | null
  enums: Enums
  measurement_system: MeasurementSystem
  /** Distinct existing locations, alphabetized — suggestions for the combobox. */
  locations: string[]
}

/**
 * Inventory detail / edit page — also the create form (item: null). All fields
 * are editable. The resource-mapping group converts resource_contribution
 * between the stored base unit and the user's display unit via util/units.ts:
 * the form shows/accepts the display unit and sends the base unit on save.
 */
export default function InventoryShow(props: PageProps) {
  const isCreate = props.item === null
  const item = props.item

  // resource_contribution is stored in base units; show it in the display unit.
  const initialContribution =
    item?.resource_type && item.resource_contribution !== null
      ? String(round3(fromBase(item.resource_type, item.resource_contribution, props.measurement_system)))
      : ''

  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? ('other' as InventoryCategory),
    quantity: item?.quantity != null ? String(item.quantity) : '',
    unit: item?.unit ?? '',
    location: item?.location ?? '',
    notes: item?.notes ?? '',
    expiry_date: item?.expiry_date ?? '',
    restock_threshold: item?.restock_threshold != null ? String(item.restock_threshold) : '',
    condition: item?.condition ?? '',
    resource_type: item?.resource_type ?? '',
    resource_contribution: initialContribution,
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // Tracks whether the user has hand-typed the Unit field, so the resource-type
  // auto-fill never clobbers a custom unit (e.g. 'cans', 'rounds'). Manual entry
  // flips it true; selecting a resource type resets it so a fresh resource
  // selection re-takes ownership of the field. It seeds true when editing an
  // existing resource-mapped item whose saved unit differs from the canonical
  // label, so a previously hand-overridden unit isn't stomped on mount.
  const unitManuallyEdited = useRef<boolean>(
    item?.resource_type != null &&
      item.unit !== '' &&
      item.unit !== displayUnitLabel(item.resource_type, props.measurement_system)
  )

  // The unit label shown next to the contribution input depends on the selected
  // resource type + the current measurement system.
  const contributionUnitLabel = useMemo(() => {
    if (!form.resource_type) return ''
    return displayUnitLabel(form.resource_type as ResourceType, props.measurement_system)
  }, [form.resource_type, props.measurement_system])

  // Auto-populate the Unit field from resource type + measurement system. When a
  // resource type is selected (water/food/power) the canonical display unit
  // drives the field — water tracks the system (gal ↔ L), food is kcal, power is
  // Wh — and it re-applies when the system flips. The field stays editable: once
  // the user hand-types a unit (unitManuallyEdited) the auto-fill backs off, and
  // an empty resource type leaves the unit untouched so free-text units survive.
  useEffect(() => {
    if (!form.resource_type) return
    if (unitManuallyEdited.current) return
    const auto = displayUnitLabel(form.resource_type as ResourceType, props.measurement_system)
    setForm((prev) => (prev.unit === auto ? prev : { ...prev, unit: auto }))
  }, [form.resource_type, props.measurement_system])

  const buildPayload = (): Record<string, unknown> => {
    const resourceType = form.resource_type === '' ? null : (form.resource_type as ResourceType)

    // Convert the display-unit contribution back to the base unit for storage.
    let resourceContribution: number | null = null
    if (resourceType && form.resource_contribution !== '') {
      resourceContribution = toBase(
        resourceType,
        Number(form.resource_contribution),
        props.measurement_system
      )
    }

    return {
      name: form.name.trim(),
      category: form.category,
      quantity: form.quantity === '' ? 0 : Number(form.quantity),
      unit: form.unit.trim(),
      location: form.location.trim() === '' ? null : form.location.trim(),
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
      expiry_date: form.expiry_date === '' ? null : form.expiry_date,
      restock_threshold:
        form.restock_threshold === '' ? null : Number(form.restock_threshold),
      condition: form.condition === '' ? null : form.condition,
      resource_type: resourceType,
      resource_contribution: resourceContribution,
    }
  }

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const url = isCreate ? '/api/inventory' : `/api/inventory/${item!.id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(buildPayload()),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.message || `HTTP ${res.status}`)
      }
      if (isCreate) {
        const data = await res.json()
        router.visit(`/inventory/${data.id}`)
        return
      }
      setMessage({ kind: 'ok', text: 'Saved' })
      router.reload({ only: ['item'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Save failed: ${msg}` })
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!item) return
    const confirmed = window.confirm(
      `Delete "${item.name}"?\n\nThis removes the catalog entry. It cannot be undone.`
    )
    if (!confirmed) return
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.visit('/readiness?tab=inventory')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Delete failed: ${msg}` })
    }
  }

  return (
    <AppLayout>
      <Head title={isCreate ? 'Add item — Inventory' : `${item!.name} — Inventory`} />

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Link
          href="/readiness?tab=inventory"
          className="inline-flex items-center gap-1 text-sm text-gray-600 mb-3 hover:text-desert-green"
        >
          <IconArrowLeft size={16} /> Back to Inventory
        </Link>

        <h1 className="text-2xl font-bold text-desert-green mb-4">
          {isCreate ? 'Add item' : item!.name}
        </h1>

        {message && (
          <div
            className={[
              'mb-4 rounded border px-3 py-2 text-sm',
              message.kind === 'ok'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-red-300 bg-red-50 text-red-900',
            ].join(' ')}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={onSave} className="space-y-4">
          <FormGroup label="Name *">
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-2 py-1.5"
            />
          </FormGroup>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup label="Category *">
              <select
                value={form.category}
                onChange={(e) => set('category', e.target.value as InventoryCategory)}
                required
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              >
                {props.enums.categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </FormGroup>

            <FormGroup label="Condition">
              <select
                value={form.condition}
                onChange={(e) => set('condition', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 capitalize"
              >
                <option value="">— none —</option>
                {props.enums.conditions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormGroup>

            <FormGroup label="Quantity *">
              <input
                type="number"
                min={0}
                step="0.001"
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                required
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>

            <FormGroup label="Unit * (e.g. gal, cans, rounds)">
              <input
                type="text"
                value={form.unit}
                onChange={(e) => {
                  // A hand-typed unit takes ownership of the field; the
                  // resource-type/system auto-fill backs off from here on.
                  unitManuallyEdited.current = true
                  set('unit', e.target.value)
                }}
                required
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>

            <FormGroup label="Location">
              {/* Combobox: a free-text input wired to a datalist of known
                  locations. Picking a suggestion fills the field; typing a
                  brand-new value just saves on the item and shows up as a
                  suggestion next time. Stays optional/nullable as before. */}
              <input
                type="text"
                list="inventory-locations"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="garage shelf B"
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
              <datalist id="inventory-locations">
                {props.locations.map((loc) => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
            </FormGroup>

            <FormGroup label="Restock threshold (low-stock flag)">
              <input
                type="number"
                min={0}
                step="0.001"
                value={form.restock_threshold}
                onChange={(e) => set('restock_threshold', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>

            <FormGroup label="Expiry date">
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => set('expiry_date', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>
          </div>

          <FormGroup label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1.5"
            />
          </FormGroup>

          <fieldset className="rounded-lg border border-gray-200 p-4 space-y-3">
            <legend className="px-1 text-sm font-semibold text-gray-700">
              Readiness mapping (optional)
            </legend>
            <p className="text-xs text-gray-500">
              Map this item to a resource so it counts toward the readiness calculator. The
              contribution is the total this whole entry provides, shown in your current units.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup label="Resource type">
                <select
                  value={form.resource_type}
                  onChange={(e) => {
                    // A fresh resource selection re-takes ownership of the Unit
                    // field so the auto-fill effect can populate the canonical
                    // label; the effect itself no-ops when the value is empty.
                    unitManuallyEdited.current = false
                    set('resource_type', e.target.value)
                  }}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 capitalize"
                >
                  <option value="">— not mapped —</option>
                  {props.enums.resource_types.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup
                label={`Contribution${contributionUnitLabel ? ` (${contributionUnitLabel})` : ''}`}
              >
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.resource_contribution}
                  onChange={(e) => set('resource_contribution', e.target.value)}
                  disabled={form.resource_type === ''}
                  placeholder={form.resource_type === '' ? 'select a resource first' : ''}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 disabled:bg-gray-50"
                />
              </FormGroup>
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            {/* StyledButton renders type="button", so it never triggers the
                form's onSubmit — submission is wired via onClick, mirroring the
                Readiness config form. The form's onSubmit stays as the Enter-key
                fallback. */}
            <StyledButton
              variant="primary"
              icon="IconDeviceFloppy"
              loading={saving}
              disabled={saving}
              onClick={() => onSave()}
            >
              {isCreate ? 'Create item' : 'Save changes'}
            </StyledButton>
            {!isCreate && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50"
              >
                <IconTrash size={16} /> Delete item
              </button>
            )}
          </div>

          <p className="text-xs text-gray-500">* required.</p>
        </form>
      </div>
    </AppLayout>
  )
}

function round3(n: number): number {
  return Number(n.toFixed(3))
}

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
