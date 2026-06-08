import { useEffect, useMemo, useRef, useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import DynamicIcon, { type DynamicIconName } from '~/components/DynamicIcon'
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
        // AdonisJS/vine returns 422 as { errors: [{ field, message }] } — surface
        // the field-level reasons (e.g. "unit: The unit field must be defined")
        // instead of an opaque "HTTP 422".
        const fieldErrors = Array.isArray(body.errors)
          ? body.errors
              .map((er: { field?: string; message?: string }) =>
                er.field ? `${er.field}: ${er.message}` : er.message
              )
              .filter(Boolean)
              .join('; ')
          : ''
        throw new Error(fieldErrors || body.error || body.message || `HTTP ${res.status}`)
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

        <form onSubmit={onSave} className="space-y-5">
          {/* Basics — what the item is. */}
          <SectionCard icon="IconBox" title="Basics">
            <FormGroup label="Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                className={INPUT_CLASS}
              />
            </FormGroup>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormGroup label="Category" required>
                <select
                  value={form.category}
                  onChange={(e) => set('category', e.target.value as InventoryCategory)}
                  required
                  className={INPUT_CLASS}
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
                  className={`${INPUT_CLASS} capitalize`}
                >
                  <option value="">— none —</option>
                  {props.enums.conditions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormGroup>
            </div>

            <FormGroup label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                className={INPUT_CLASS}
              />
            </FormGroup>
          </SectionCard>

          {/* Stock & expiry — how much, where, and how long it lasts. */}
          <SectionCard icon="IconStack2" title="Stock & expiry">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormGroup label="Quantity" required>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  required
                  className={INPUT_CLASS}
                />
              </FormGroup>

              <FormGroup
                label="Unit"
                hint="For consumables (e.g. gal, cans). Leave blank for gear."
              >
                <input
                  type="text"
                  value={form.unit}
                  onChange={(e) => {
                    // A hand-typed unit takes ownership of the field; the
                    // resource-type/system auto-fill backs off from here on.
                    unitManuallyEdited.current = true
                    set('unit', e.target.value)
                  }}
                  className={INPUT_CLASS}
                />
              </FormGroup>

              <FormGroup
                label="Restock threshold"
                hint="Flags low stock when quantity drops to this."
              >
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.restock_threshold}
                  onChange={(e) => set('restock_threshold', e.target.value)}
                  className={INPUT_CLASS}
                />
              </FormGroup>

              <FormGroup label="Expiry date">
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => set('expiry_date', e.target.value)}
                  className={INPUT_CLASS}
                />
              </FormGroup>

              <FormGroup label="Location" className="sm:col-span-2">
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
                  className={INPUT_CLASS}
                />
                <datalist id="inventory-locations">
                  {props.locations.map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </FormGroup>
            </div>
          </SectionCard>

          {/* Readiness mapping — optional link into the readiness calculator. */}
          <SectionCard icon="IconShieldCheck" title="Readiness mapping" optional>
            <p className="text-xs text-desert-stone">
              Map this item to a resource so it counts toward the readiness calculator. The
              contribution is the total this whole entry provides, shown in your current units.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  className={`${INPUT_CLASS} capitalize`}
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
                  className={`${INPUT_CLASS} disabled:bg-desert-sand`}
                />
              </FormGroup>
            </div>
          </SectionCard>

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

          <p className="text-xs text-desert-stone">
            <span className="text-desert-red">*</span> required.
          </p>
        </form>
      </div>
    </AppLayout>
  )
}

function round3(n: number): number {
  return Number(n.toFixed(3))
}

/**
 * Shared input styling for the form. White input on a white section card, with a
 * desert-stone border and a desert-green focus ring, so the page → card → input
 * layering reads clearly against the beige (desert-sand) page.
 */
const INPUT_CLASS =
  'w-full rounded-md border border-desert-stone-lighter bg-white px-2.5 py-1.5 text-sm text-gray-900 ' +
  'focus:border-desert-green focus:outline-none focus:ring-1 focus:ring-desert-green'

/**
 * An elevated white section card on the beige page: a desert-green header with a
 * tabler icon (via DynamicIcon) over a low-opacity shadow, grouping a set of
 * related fields. `optional` appends a muted "(optional)" to the header.
 */
function SectionCard({
  icon,
  title,
  optional,
  children,
}: {
  icon: DynamicIconName
  title: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-desert-stone-lighter bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-desert-green">
        <DynamicIcon icon={icon} className="h-4 w-4 text-desert-green" />
        {title}
        {optional && <span className="font-normal text-desert-stone">(optional)</span>}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function FormGroup({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-desert-red">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-desert-stone">{hint}</p>}
    </div>
  )
}
