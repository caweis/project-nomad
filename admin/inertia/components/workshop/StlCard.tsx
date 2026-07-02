import { Link } from '@inertiajs/react'
import { IconBox, IconAlertTriangle, IconCube, IconFileTypePdf, IconPhoto } from '@tabler/icons-react'
import type { StlFileSlim, WorkshopFileTypeEnum } from '../../../types/stl_library'
import { CATEGORY_LABELS } from '../../../types/stl_library'

const FILE_TYPE_BADGE: Record<WorkshopFileTypeEnum, string> = {
  stl: 'STL',
  cad: 'CAD',
  pdf: 'PDF',
  image: 'IMG',
}

/** Per-type icon shown when there is no thumbnail (or thumbnail_failed). */
function FileTypeIcon({ fileType, size }: { fileType: WorkshopFileTypeEnum; size: number }) {
  const cls = `text-text-muted`
  switch (fileType) {
    case 'cad':
      return <IconCube size={size} className={cls} aria-hidden="true" />
    case 'pdf':
      return <IconFileTypePdf size={size} className={cls} aria-hidden="true" />
    case 'image':
      return <IconPhoto size={size} className={cls} aria-hidden="true" />
    case 'stl':
    default:
      return <IconBox size={size} className={cls} aria-hidden="true" />
  }
}

interface StlCardProps {
  file: StlFileSlim
  /** When true, render a selection checkbox overlay for batch operations. */
  selectable?: boolean
  /** Whether this card is currently selected (only meaningful when selectable). */
  selected?: boolean
  /** Called with the file id when the selection checkbox is toggled. */
  onToggleSelect?: (id: number) => void
}

/**
 * One tile in the Workshop grid. Shows thumbnail, name, category badge,
 * material, and print-time at a glance. Files with metadata_pending get a
 * yellow "Needs metadata" pill and a slightly muted appearance so the user
 * spots them in a sea of finished entries.
 *
 * When `selectable` is true a checkbox overlays the top-left corner; toggling
 * it drives batch selection in the parent and must NOT navigate to the detail
 * page (the checkbox stops click/keydown propagation and prevents default so
 * the surrounding <Link> doesn't fire). With `selectable` false the card
 * behaves exactly as before — a plain link to the detail page.
 *
 * Fallbacks:
 *   • No thumbnail yet (or render failed) → generic 3D-box SVG icon
 *   • print_time_minutes null → "—" (typical for pending files)
 */
export default function StlCard({ file, selectable, selected, onToggleSelect }: StlCardProps) {
  const printTimeLabel = formatPrintTime(file.print_time_minutes)
  const sizeMb = (file.file_size_bytes / 1024 / 1024).toFixed(1)

  return (
    <Link
      href={`/workshop/${file.id}`}
      className={[
        'group relative flex flex-col rounded-lg border bg-surface-primary overflow-hidden',
        'shadow-sm hover:shadow-md transition-shadow',
        selected
          ? 'border-desert-green ring-2 ring-desert-green'
          : file.metadata_pending
            ? 'border-amber-300 ring-1 ring-amber-200'
            : 'border-border-subtle',
      ].join(' ')}
    >
      {selectable && (
        <label
          className="absolute top-2 left-2 z-20 flex items-center justify-center rounded bg-surface-primary/90 p-1 shadow-sm cursor-pointer"
          onClick={(e) => {
            // Keep the click off the surrounding <Link> so toggling selection
            // never navigates to the detail page.
            e.preventDefault()
            e.stopPropagation()
            onToggleSelect?.(file.id)
          }}
        >
          <input
            type="checkbox"
            checked={!!selected}
            aria-label={`Select ${file.name}`}
            onChange={() => {}}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 accent-desert-green cursor-pointer"
          />
        </label>
      )}

      {file.metadata_pending && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          <IconAlertTriangle size={12} aria-hidden="true" />
          Needs metadata
        </div>
      )}

      <div className="relative aspect-square bg-surface-secondary flex items-center justify-center">
        {file.thumbnail_path ? (
          <img
            src={`/api/workshop/files/${file.id}/thumbnail`}
            alt={file.name}
            className="object-contain w-full h-full"
            loading="lazy"
          />
        ) : (
          <FileTypeIcon fileType={file.file_type} size={64} />
        )}
      </div>

      <div className="p-3 flex flex-col gap-1">
        <div className="font-semibold text-sm text-text-primary truncate" title={file.name}>
          {file.name}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary flex-wrap">
          {/* File-type badge */}
          <span className="inline-block rounded bg-surface-secondary text-text-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            {FILE_TYPE_BADGE[file.file_type]}
          </span>
          <span className="inline-block rounded-full bg-desert-green-light text-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {CATEGORY_LABELS[file.category]}
          </span>
          {file.file_type === 'stl' && <span>{file.material ?? '—'}</span>}
        </div>
        <div className="flex items-center justify-between text-[11px] text-text-muted mt-1">
          <span>{file.file_type === 'stl' ? printTimeLabel : ''}</span>
          <span>{sizeMb} MB</span>
        </div>
      </div>
    </Link>
  )
}

/**
 * Human-readable print-time. 0 / null → em-dash. Under 60 minutes → "Xm".
 * 60–1440 → "Xh Ym". 1440+ → "Xd Yh" (rare but happens with massive
 * tree-support-heavy multi-day prints).
 */
function formatPrintTime(minutes: number | null): string {
  if (minutes === null || minutes === 0) return '—'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  const d = Math.floor(minutes / (60 * 24))
  const h = Math.floor((minutes % (60 * 24)) / 60)
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}
