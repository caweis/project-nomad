import { Link } from '@inertiajs/react'
import type { ConditionSummary } from '../../../types/conditions'

interface Props {
  condition: ConditionSummary
}

/**
 * A single curated-condition tile in the browse grid. Links to the condition
 * detail page (/conditions/:slug). Uses the desert-* theme to match the rest of
 * the admin surface.
 */
export default function ConditionCard({ condition }: Props) {
  return (
    <Link
      href={`/conditions/${condition.slug}`}
      className="group flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-desert-green hover:bg-desert-green/5"
    >
      <span className="font-medium text-sm text-gray-900 group-hover:text-desert-green">
        {condition.label}
      </span>
      <span className="ml-3 flex-shrink-0 text-gray-400 text-xs">&rsaquo;</span>
    </Link>
  )
}
