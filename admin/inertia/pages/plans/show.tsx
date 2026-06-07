import { useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import {
  IconArrowLeft,
  IconTrash,
  IconBox,
  IconClipboardList,
  IconBook,
  IconExternalLink,
  IconPencil,
  IconX,
} from '@tabler/icons-react'
import { resolveStepLink, type StepLinkKind } from '../../../util/scenario_links'
import {
  SCENARIO_LABELS,
  type Scenario,
  type ScenarioPlanDetail,
  type ScenarioPlanStepDto,
} from '../../../types/scenarios'

interface Enums {
  scenarios: { value: Scenario; label: string }[]
}

interface PageProps {
  /** null in create mode. */
  plan: ScenarioPlanDetail | null
  enums: Enums
}

/**
 * Scenario Plan detail / edit page — also the create form (plan: null).
 *
 * Create mode shows just the plan form. In edit mode the page shows the plan
 * header + editable plan form, the ordered checkable step list, and an inline
 * add-step form. Every Save/Create/Add button is wired via onClick because
 * StyledButton renders type="button" and so never triggers a <form onSubmit>
 * (the non-submitting-Save bug the Inventory/Readiness pages already guard
 * against). The forms keep onSubmit only as the Enter-key fallback.
 */
export default function PlansShow(props: PageProps) {
  const isCreate = props.plan === null

  return (
    <AppLayout>
      <Head title={isCreate ? 'New plan — Scenario Plans' : `${props.plan!.title} — Scenario Plans`} />

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Link
          href="/plans"
          className="inline-flex items-center gap-1 text-sm text-gray-600 mb-3 hover:text-desert-green"
        >
          <IconArrowLeft size={16} /> Back to Scenario Plans
        </Link>

        {isCreate ? (
          <PlanForm enums={props.enums} plan={null} />
        ) : (
          <PlanEditor plan={props.plan!} enums={props.enums} />
        )}
      </div>
    </AppLayout>
  )
}

// ─── Plan create/edit form ────────────────────────────────────────────────────

function PlanForm({ plan, enums }: { plan: ScenarioPlanDetail | null; enums: Enums }) {
  const isCreate = plan === null
  const [form, setForm] = useState({
    scenario: plan?.scenario ?? ('blackout' as Scenario),
    title: plan?.title ?? '',
    description: plan?.description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const url = isCreate ? '/api/plans' : `/api/plans/${plan!.id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
          scenario: form.scenario,
          title: form.title.trim(),
          description: form.description.trim() === '' ? null : form.description.trim(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.message || `HTTP ${res.status}`)
      }
      if (isCreate) {
        const data = await res.json()
        router.visit(`/plans/${data.id}`)
        return
      }
      setMessage({ kind: 'ok', text: 'Saved' })
      router.reload({ only: ['plan'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Save failed: ${msg}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <h1 className="text-2xl font-bold text-desert-green">
        {isCreate ? 'New plan' : 'Edit plan'}
      </h1>

      {message && <Banner message={message} />}

      <FormGroup label="Scenario *">
        <select
          value={form.scenario}
          onChange={(e) => set('scenario', e.target.value as Scenario)}
          className="w-full rounded border border-gray-300 px-2 py-1.5"
        >
          {enums.scenarios.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FormGroup>

      <FormGroup label="Title *">
        <input
          type="text"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          required
          className="w-full rounded border border-gray-300 px-2 py-1.5"
        />
      </FormGroup>

      <FormGroup label="Description">
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          className="w-full rounded border border-gray-300 px-2 py-1.5"
        />
      </FormGroup>

      {/* StyledButton renders type="button"; submission is wired via onClick. */}
      <StyledButton
        variant="primary"
        icon="IconDeviceFloppy"
        loading={saving}
        disabled={saving}
        onClick={() => onSave()}
      >
        {isCreate ? 'Create plan' : 'Save plan'}
      </StyledButton>

      <p className="text-xs text-gray-500">* required.</p>
    </form>
  )
}

// ─── Plan editor (header + plan form + steps) ──────────────────────────────────

function PlanEditor({ plan, enums }: { plan: ScenarioPlanDetail; enums: Enums }) {
  const [editingPlan, setEditingPlan] = useState(false)

  const onDeletePlan = async () => {
    const confirmed = window.confirm(
      `Delete "${plan.title}"?\n\nThis removes the plan and all its steps. It cannot be undone.`
    )
    if (!confirmed) return
    try {
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.visit('/plans')
    } catch {
      // Stay on the page; the user can retry.
    }
  }

  return (
    <div className="space-y-6">
      {editingPlan ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <PlanForm plan={plan} enums={enums} />
          <button
            type="button"
            onClick={() => setEditingPlan(false)}
            className="mt-3 text-sm text-gray-500 hover:text-desert-green inline-flex items-center gap-1"
          >
            <IconX size={14} /> Done editing
          </button>
        </div>
      ) : (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
              {SCENARIO_LABELS[plan.scenario]}
            </div>
            <h1 className="text-2xl font-bold text-desert-green">{plan.title}</h1>
            {plan.description && <p className="text-sm text-gray-600 mt-1">{plan.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditingPlan(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <IconPencil size={16} /> Edit plan
            </button>
            <button
              type="button"
              onClick={onDeletePlan}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50"
            >
              <IconTrash size={16} /> Delete
            </button>
          </div>
        </header>
      )}

      <StepList plan={plan} />
      <AddStepForm planId={plan.id} />
    </div>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function StepList({ plan }: { plan: ScenarioPlanDetail }) {
  if (plan.steps.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        No steps yet. Add the first step below.
      </div>
    )
  }
  return (
    <ol className="space-y-2">
      {plan.steps.map((step) => (
        <StepRow key={step.id} planId={plan.id} step={step} />
      ))}
    </ol>
  )
}

const LINK_META: Record<Exclude<StepLinkKind, 'none'>, { label: string; icon: React.ReactNode }> = {
  inventory: { label: 'Inventory item', icon: <IconClipboardList size={14} /> },
  stl: { label: 'Printable file', icon: <IconBox size={14} /> },
  zim: { label: 'Offline article', icon: <IconBook size={14} /> },
}

function StepRow({ planId, step }: { planId: number; step: ScenarioPlanStepDto }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  // With no link_type discriminator column (see scenario_links.ts), a step whose
  // FK was SET NULL'd on target deletion is indistinguishable from a never-linked
  // step — both resolve to kind 'none'. So a removed target degrades silently to
  // "unlinked": the step text still renders, just without a link. No "removed"
  // marker is shown because there's nothing to reliably detect it from.
  const link = resolveStepLink(step)

  const onToggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/plans/${planId}/steps/${step.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ checked: !step.checked }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.reload({ only: ['plan'] })
    } catch {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (!window.confirm('Delete this step?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/plans/${planId}/steps/${step.id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.reload({ only: ['plan'] })
    } catch {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-gray-300 bg-white p-3">
        <StepForm
          planId={planId}
          step={step}
          onDone={() => {
            setEditing(false)
            router.reload({ only: ['plan'] })
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 flex items-start gap-3">
      <input
        type="checkbox"
        checked={step.checked}
        disabled={busy}
        onChange={onToggle}
        className="mt-1 h-4 w-4 shrink-0 accent-desert-green"
        aria-label={step.checked ? 'Mark step not done' : 'Mark step done'}
      />
      <div className="min-w-0 flex-1">
        <p className={['text-sm', step.checked ? 'text-gray-400 line-through' : 'text-gray-900'].join(' ')}>
          {step.text}
        </p>
        {link.kind !== 'none' && link.href && (
          <a
            href={link.href}
            className="mt-1 inline-flex items-center gap-1 text-xs text-desert-green hover:underline"
          >
            {LINK_META[link.kind].icon}
            {step.linked_name ?? LINK_META[link.kind].label}
            {link.kind === 'zim' && <IconExternalLink size={12} />}
          </a>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 text-gray-400 hover:text-desert-green"
          aria-label="Edit step"
        >
          <IconPencil size={16} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
          aria-label="Delete step"
        >
          <IconTrash size={16} />
        </button>
      </div>
    </li>
  )
}

/**
 * Inline add-step form below the list. Wires the Add button via onClick.
 */
function AddStepForm({ planId }: { planId: number }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3">
      <StepForm
        planId={planId}
        step={null}
        onDone={() => router.reload({ only: ['plan'] })}
        onCancel={null}
      />
    </div>
  )
}

/**
 * Shared step create/edit form. `step === null` → create; otherwise edit.
 * Save/Add is wired via onClick (StyledButton is type="button"); the form's
 * onSubmit is the Enter-key fallback.
 */
function StepForm({
  planId,
  step,
  onDone,
  onCancel,
}: {
  planId: number
  step: ScenarioPlanStepDto | null
  onDone: () => void
  onCancel: (() => void) | null
}) {
  const isCreate = step === null

  // Pick the existing link kind so the editor preselects the right field.
  const initialLinkKind: StepLinkKind = step
    ? resolveStepLink(step).kind
    : 'none'

  const [form, setForm] = useState({
    text: step?.text ?? '',
    linkKind: initialLinkKind,
    inventory_item_id: step?.inventory_item_id != null ? String(step.inventory_item_id) : '',
    stl_file_id: step?.stl_file_id != null ? String(step.stl_file_id) : '',
    zim_ref: step?.zim_ref ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const buildLinkPayload = (): {
    inventory_item_id: number | null
    stl_file_id: number | null
    zim_ref: string | null
  } => {
    // Only the selected link kind contributes; the others are explicitly null so
    // an edit that switches kinds clears the previous one.
    switch (form.linkKind) {
      case 'inventory':
        return {
          inventory_item_id: form.inventory_item_id === '' ? null : Number(form.inventory_item_id),
          stl_file_id: null,
          zim_ref: null,
        }
      case 'stl':
        return {
          inventory_item_id: null,
          stl_file_id: form.stl_file_id === '' ? null : Number(form.stl_file_id),
          zim_ref: null,
        }
      case 'zim':
        return {
          inventory_item_id: null,
          stl_file_id: null,
          zim_ref: form.zim_ref.trim() === '' ? null : form.zim_ref.trim(),
        }
      default:
        return { inventory_item_id: null, stl_file_id: null, zim_ref: null }
    }
  }

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const url = isCreate
        ? `/api/plans/${planId}/steps`
        : `/api/plans/${planId}/steps/${step!.id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ text: form.text.trim(), ...buildLinkPayload() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.message || `HTTP ${res.status}`)
      }
      if (isCreate) {
        // Reset so the add form is ready for the next step.
        setForm({ text: '', linkKind: 'none', inventory_item_id: '', stl_file_id: '', zim_ref: '' })
      }
      onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Save failed: ${msg}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-2">
      {message && <Banner message={message} />}

      <textarea
        value={form.text}
        onChange={(e) => set('text', e.target.value)}
        placeholder={isCreate ? 'Add a step…' : 'Step text'}
        rows={2}
        required
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Link (optional)</label>
          <select
            value={form.linkKind}
            onChange={(e) => set('linkKind', e.target.value as StepLinkKind)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="none">— no link —</option>
            <option value="inventory">Inventory item (id)</option>
            <option value="stl">Printable file (id)</option>
            <option value="zim">Offline article (URL)</option>
          </select>
        </div>

        {form.linkKind === 'inventory' && (
          <LinkInput
            label="Inventory item id"
            type="number"
            value={form.inventory_item_id}
            onChange={(v) => set('inventory_item_id', v)}
          />
        )}
        {form.linkKind === 'stl' && (
          <LinkInput
            label="STL file id"
            type="number"
            value={form.stl_file_id}
            onChange={(v) => set('stl_file_id', v)}
          />
        )}
        {form.linkKind === 'zim' && (
          <LinkInput
            label="Article URL"
            type="text"
            value={form.zim_ref}
            onChange={(v) => set('zim_ref', v)}
          />
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        {/* onClick — StyledButton is type="button". */}
        <StyledButton
          variant="primary"
          size="sm"
          icon={isCreate ? 'IconPlus' : 'IconDeviceFloppy'}
          loading={saving}
          disabled={saving}
          onClick={() => onSave()}
        >
          {isCreate ? 'Add step' : 'Save step'}
        </StyledButton>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-desert-green"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function LinkInput({
  label,
  type,
  value,
  onChange,
}: {
  label: string
  type: 'number' | 'text'
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        min={type === 'number' ? 1 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </div>
  )
}

// ─── shared bits ──────────────────────────────────────────────────────────────

function Banner({ message }: { message: { kind: 'ok' | 'err'; text: string } }) {
  return (
    <div
      className={[
        'rounded border px-3 py-2 text-sm',
        message.kind === 'ok'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-red-300 bg-red-50 text-red-900',
      ].join(' ')}
    >
      {message.text}
    </div>
  )
}

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
