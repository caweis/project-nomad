import { useRef, useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import WorkshopRightsModal from '~/components/workshop/WorkshopRightsModal'
import {
  IconArrowLeft,
  IconAlertTriangle,
  IconBox,
  IconDownload,
  IconTrash,
  IconPhotoUp,
} from '@tabler/icons-react'
import type {
  StlCategory,
  StlDifficulty,
  StlFileDetail,
  StlMaterial,
} from '../../../types/stl_library'

interface PageProps {
  file: StlFileDetail
  file_available: boolean
  enums: {
    categories: { value: StlCategory; label: string }[]
    materials: StlMaterial[]
    difficulties: StlDifficulty[]
  }
  rights_acknowledged: boolean
}

/**
 * Workshop detail / edit page. Loads with current values; user edits and
 * hits Save. Save PATCHes /api/workshop/files/:id which recomputes
 * metadata_pending automatically. Delete asks first — that nukes both the
 * DB row AND the file on disk.
 */
export default function WorkshopShow(props: PageProps) {
  const [rightsOpen, setRightsOpen] = useState(!props.rights_acknowledged)
  const [form, setForm] = useState({
    name: props.file.name,
    category: props.file.category,
    tags: props.file.tags.join(', '),
    material: props.file.material ?? '',
    print_time_minutes: props.file.print_time_minutes ?? '',
    infill_pct: props.file.infill_pct ?? '',
    difficulty: props.file.difficulty ?? '',
    description: props.file.description ?? '',
    source_url: props.file.source_url ?? '',
    license: props.file.license ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [thumbUploading, setThumbUploading] = useState(false)
  const [thumbError, setThumbError] = useState<string | null>(null)
  // Cache-buster so a freshly-uploaded thumbnail replaces the cached <img>
  // (the serve endpoint sends Cache-Control: private, max-age=3600).
  const [thumbVersion, setThumbVersion] = useState(0)
  const thumbInputRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)
    const payload: Record<string, unknown> = {
      name: form.name,
      category: form.category,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      material: form.material === '' ? null : form.material,
      print_time_minutes: form.print_time_minutes === '' ? null : Number(form.print_time_minutes),
      infill_pct: form.infill_pct === '' ? null : Number(form.infill_pct),
      difficulty: form.difficulty === '' ? null : form.difficulty,
      description: form.description === '' ? null : form.description,
      source_url: form.source_url === '' ? null : form.source_url,
      license: form.license === '' ? null : form.license,
    }
    try {
      const res = await fetch(`/api/workshop/files/${props.file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || `HTTP ${res.status}`)
      }
      const data = await res.json()
      // Compute which required fields are still missing so the toast can
      // tell the user the truth (the previous hardcoded message listed all
      // four required fields even when three were filled — looked like the
      // save hadn't persisted anything). Logic mirrors
      // StlFile.isMetadataComplete on the server.
      const missing: string[] = []
      if (!form.name || !form.name.trim()) missing.push('name')
      if (!form.material) missing.push('material')
      if (form.print_time_minutes === '' || Number(form.print_time_minutes) <= 0) {
        missing.push('print time')
      }
      if (!form.difficulty) missing.push('difficulty')

      let text: string
      if (!data.metadata_pending) {
        text = 'Saved — file is fully cataloged'
      } else if (missing.length > 0) {
        text = `Saved — still missing required metadata: ${missing.join(', ')}`
      } else {
        // Client/server logic mismatch fallback — shouldn't normally hit this.
        text = 'Saved — still missing required metadata'
      }
      setMessage({ kind: 'ok', text })
      // Refresh the file prop so the rest of the page mirrors the new state.
      router.reload({ only: ['file'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Save failed: ${msg}` })
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    const confirmed = window.confirm(
      `Delete "${props.file.name}"?\n\nThis removes the file from disk AND the catalog. ` +
        `Cannot be undone except by re-importing the file.`
    )
    if (!confirmed) return
    try {
      const res = await fetch(`/api/workshop/files/${props.file.id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.visit('/workshop')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Delete failed: ${msg}` })
    }
  }

  const onThumbnailSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return

    setThumbUploading(true)
    setThumbError(null)
    try {
      const body = new FormData()
      body.append('thumbnail', file)
      const res = await fetch(`/api/workshop/files/${props.file.id}/thumbnail-upload`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.message || `HTTP ${res.status}`)
      }
      setThumbVersion((v) => v + 1)
      // Refresh the file prop so thumbnail_path / thumbnail_failed update.
      router.reload({ only: ['file'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setThumbError(`Thumbnail upload failed: ${msg}`)
    } finally {
      setThumbUploading(false)
    }
  }

  const sizeMb = (props.file.file_size_bytes / 1024 / 1024).toFixed(2)

  return (
    <AppLayout>
      <Head title={`${props.file.name} — Workshop`} />
      <WorkshopRightsModal open={rightsOpen} onAccept={() => setRightsOpen(false)} />

      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <Link href="/workshop" className="inline-flex items-center gap-1 text-sm text-gray-600 mb-3 hover:text-desert-green">
          <IconArrowLeft size={16} /> Back to Workshop
        </Link>

        {!props.file_available && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
            <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              The file on disk wasn't found at <code className="bg-white px-1 rounded">{props.file.path}</code>.
              The drive may be disconnected, or the file was deleted outside the catalog. Saving
              metadata still works; download won't until the file's back.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
          <aside className="space-y-4">
            <div className="aspect-square bg-white border border-gray-200 rounded-lg flex items-center justify-center overflow-hidden">
              {props.file.thumbnail_path ? (
                <img
                  src={`/api/workshop/files/${props.file.id}/thumbnail?v=${thumbVersion}`}
                  alt={props.file.name}
                  className="object-contain w-full h-full"
                />
              ) : (
                <IconBox size={96} className="text-gray-300" />
              )}
            </div>

            <ThumbnailUpload
              failed={props.file.thumbnail_failed}
              hasThumbnail={!!props.file.thumbnail_path}
              uploading={thumbUploading}
              error={thumbError}
              inputRef={thumbInputRef}
              onPick={() => thumbInputRef.current?.click()}
              onSelected={onThumbnailSelected}
            />
            <dl className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-1">
              <Field label="Path" value={props.file.path} mono />
              <Field label="Size" value={`${sizeMb} MB`} />
              <Field label="Added" value={props.file.added_at.slice(0, 10)} />
              <Field label="Last scanned" value={props.file.last_indexed_at.slice(0, 10)} />
              {props.file.file_hash && (
                <Field label="Hash (first 1MB)" value={props.file.file_hash.slice(0, 12) + '…'} mono />
              )}
              <Field
                label="Status"
                value={props.file.metadata_pending ? 'Pending metadata' : 'Complete'}
              />
            </dl>

            <div className="flex flex-col gap-2">
              <a
                href={`/api/workshop/files/${props.file.id}/download`}
                className={[
                  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium',
                  props.file_available
                    ? 'bg-desert-green text-white hover:bg-desert-green/90'
                    : 'bg-gray-200 text-gray-400 pointer-events-none',
                ].join(' ')}
              >
                <IconDownload size={16} /> Download file
              </a>
              <button
                onClick={onDelete}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50"
              >
                <IconTrash size={16} /> Delete file + catalog entry
              </button>
            </div>
          </aside>

          <form onSubmit={onSave} className="space-y-4">
            <h1 className="text-2xl font-bold text-desert-green">{props.file.name}</h1>

            {message && (
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
            )}

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
                  onChange={(e) => set('category', e.target.value as StlCategory)}
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

              <FormGroup label="Material *">
                <select
                  value={form.material}
                  onChange={(e) => set('material', e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5"
                >
                  <option value="">— select —</option>
                  {props.enums.materials.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup label="Print time (minutes) *">
                <input
                  type="number"
                  min={0}
                  value={form.print_time_minutes}
                  onChange={(e) => set('print_time_minutes', e.target.value as never)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5"
                />
              </FormGroup>

              <FormGroup label="Infill %">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.infill_pct}
                  onChange={(e) => set('infill_pct', e.target.value as never)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5"
                />
              </FormGroup>

              <FormGroup label="Difficulty *">
                <select
                  value={form.difficulty}
                  onChange={(e) => set('difficulty', e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 capitalize"
                >
                  <option value="">— select —</option>
                  {props.enums.difficulties.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup label="License (freeform)">
                <input
                  type="text"
                  value={form.license}
                  onChange={(e) => set('license', e.target.value)}
                  placeholder="CC0 / CC-BY-4.0 / my own work / etc."
                  className="w-full rounded border border-gray-300 px-2 py-1.5"
                />
              </FormGroup>
            </div>

            <FormGroup label="Tags (comma-separated)">
              <input
                type="text"
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="finger-splint, pediatric, single-piece"
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>

            <FormGroup label="Source URL">
              <input
                type="url"
                value={form.source_url}
                onChange={(e) => set('source_url', e.target.value)}
                placeholder="https://3dprint.nih.gov/discover/..."
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>

            <FormGroup label="Description / print notes">
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={4}
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </FormGroup>

            <p className="text-xs text-gray-500">* required to leave the "Needs metadata" state.</p>

            {/* StyledButton renders type="button", so it never triggers the
                form's onSubmit — wire Save via onClick (the form's onSubmit
                stays as the Enter-key fallback). */}
            <StyledButton
              variant="primary"
              icon="IconDeviceFloppy"
              loading={saving}
              disabled={saving}
              onClick={() => onSave()}
            >
              Save changes
            </StyledButton>
          </form>
        </div>
      </div>
    </AppLayout>
  )
}

/**
 * Manual PNG thumbnail upload. Prominent (amber) when the auto-renderer failed
 * — that's the path the feature exists for; otherwise it's a quiet "Replace
 * thumbnail" affordance so the user can swap in a nicer render any time.
 * PNG-only, matching the serve endpoint's hardcoded Content-Type.
 */
function ThumbnailUpload({
  failed,
  hasThumbnail,
  uploading,
  error,
  inputRef,
  onPick,
  onSelected,
}: {
  failed: boolean
  hasThumbnail: boolean
  uploading: boolean
  error: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onPick: () => void
  onSelected: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const label = uploading
    ? 'Uploading…'
    : hasThumbnail
      ? 'Replace thumbnail (PNG)'
      : 'Upload thumbnail (PNG)'

  return (
    <div
      className={[
        'rounded-lg border p-3 text-sm',
        failed ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white',
      ].join(' ')}
    >
      {failed && (
        <p className="mb-2 flex items-start gap-1.5 text-amber-900">
          <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Automatic thumbnail generation failed for this file. Upload a PNG by hand.</span>
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,.png"
        className="hidden"
        onChange={onSelected}
      />
      <button
        type="button"
        onClick={onPick}
        disabled={uploading}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <IconPhotoUp size={16} /> {label}
      </button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className={mono ? 'font-mono text-xs truncate max-w-[160px]' : 'truncate max-w-[160px]'} title={value}>
        {value}
      </dd>
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
