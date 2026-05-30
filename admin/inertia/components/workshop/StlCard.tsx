import { Link } from '@inertiajs/react'
import { IconBox, IconAlertTriangle } from '@tabler/icons-react'
import type { StlFileSlim } from '../../../types/stl_library'
import { CATEGORY_LABELS } from '../../../types/stl_library'

/**
 * One tile in the Workshop grid. Shows thumbnail, name, category badge,
 * material, and print-time at a glance. Files with metadata_pending get a
 * yellow "Needs metadata" pill and a slightly muted appearance so the user
 * spots them in a sea of finished entries.
 *
 * Fallbacks:
 *   • No thumbnail yet (or render failed) → generic 3D-box SVG icon
 *   • print_time_minutes null → "—" (typical for pending files)
 */
export default function StlCard({ file }: { file: StlFileSlim }) {
  const printTimeLabel = formatPrintTime(file.print_time_minutes)
  const sizeMb = (file.file_size_bytes / 1024 / 1024).toFixed(1)

  return (
    <Link
      href={`/workshop/${file.id}`}
      className={[
        'group relative flex flex-col rounded-lg border bg-white overflow-hidden',
        'shadow-sm hover:shadow-md transition-shadow',
        file.metadata_pending ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200',
      ].join(' ')}
    >
      {file.metadata_pending && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          <IconAlertTriangle size={12} aria-hidden="true" />
          Needs metadata
        </div>
      )}

      <div className="relative aspect-square bg-gray-50 flex items-center justify-center">
        {file.thumbnail_path ? (
          <img
            src={`/api/workshop/files/${file.id}/thumbnail`}
            alt={file.name}
            className="object-contain w-full h-full"
            loading="lazy"
          />
        ) : (
          <IconBox size={64} className="text-gray-300" aria-hidden="true" />
        )}
      </div>

      <div className="p-3 flex flex-col gap-1">
        <div className="font-semibold text-sm text-gray-900 truncate" title={file.name}>
          {file.name}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="inline-block rounded-full bg-desert-green-light text-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {CATEGORY_LABELS[file.category]}
          </span>
          <span>{file.material ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1">
          <span>{printTimeLabel}</span>
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
