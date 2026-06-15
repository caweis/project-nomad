import type { DrugInteractionEntry } from '../../../types/drug_reference'
import { PRODUCT_TYPES } from '../../../types/drug_reference'
import { parseInteractions, isSectionHeader, type InteractionBlock } from '../../../util/drug_interactions'

interface Props {
  entry: DrugInteractionEntry
  onRemove: (id: number) => void
}

/**
 * One column in the side-by-side drug interaction comparison view.
 *
 * Shows the drug identity (brand + generic name, OTC/Rx badge), then the
 * drug_interactions text from the FDA label, or a muted "No labeled
 * interaction text" note when the field is absent.
 */
export default function InteractionColumn({ entry, onRemove }: Props) {
  const isRx = entry.product_type === PRODUCT_TYPES.RX
  const isOtc = entry.product_type === PRODUCT_TYPES.OTC
  const displayName = entry.brand_name ?? entry.generic_name ?? 'Unknown Drug'

  return (
    <div className="flex flex-col min-w-0 border border-gray-200 rounded-lg overflow-hidden">
      {/* Column header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
              <span className="font-semibold text-sm text-gray-900 break-words">
                {displayName}
              </span>
              {isRx && (
                <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200 flex-shrink-0">
                  Rx
                </span>
              )}
              {isOtc && (
                <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 flex-shrink-0">
                  OTC
                </span>
              )}
            </div>
            {entry.brand_name && entry.generic_name && (
              <p className="text-xs text-gray-500 italic truncate">{entry.generic_name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            aria-label={`Remove ${displayName} from comparison`}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none ml-1 mt-0.5"
          >
            ×
          </button>
        </div>
      </div>

      {/* Label text, parsed into readable blocks (FDA wording kept verbatim). */}
      <div className="px-4 py-3 flex-1 space-y-3">
        {entry.drug_interactions ? (
          parseInteractions(entry.drug_interactions).map((block, i) => (
            <InteractionBlockView key={i} block={block} />
          ))
        ) : (
          <p className="text-sm text-gray-400 italic">
            No labeled interaction text on this label.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Renders one parsed interaction block: a bullet list, the muted section header,
 * or a paragraph with its subsection number ("7.1") shown as a small badge.
 */
function InteractionBlockView({ block }: { block: InteractionBlock }) {
  if (block.bullets) {
    return (
      <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-800 leading-relaxed">
        {block.bullets.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    )
  }

  if (isSectionHeader(block.text)) {
    return (
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {block.text!.replace(/^\s*\d{1,2}\s+/, '')}
      </p>
    )
  }

  return (
    <p className="text-sm text-gray-800 leading-relaxed">
      {block.label && (
        <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold align-baseline">
          {block.label}
        </span>
      )}
      {block.text}
    </p>
  )
}
