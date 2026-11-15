import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import type { RemoteZimFileEntry } from '../../types/zim'
import { formatBytes } from '~/lib/util'
import StyledButton from '~/components/StyledButton'

type Props = {
  items: RemoteZimFileEntry[]
  loading: boolean
  onDownload: (item: RemoteZimFileEntry) => void
  onScroll: (element: HTMLDivElement) => void
}

export function formattedCatalogDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export default function VirtualizedZimCatalog({ items, loading, onDownload, onScroll }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 62,
    overscan: 5,
    getItemKey: (index) => items[index]?.id ?? index,
  })
  useEffect(() => {
    if (scrollRef.current && items.length > 0) onScroll(scrollRef.current)
  }, [items.length, onScroll])

  return (
    <div
      ref={scrollRef}
      className="mt-4 h-[600px] w-full overflow-auto rounded-lg border border-border-default bg-surface-primary"
      onScroll={(event) => onScroll(event.currentTarget)}
      role="table"
      aria-label="Kiwix library"
    >
      <div
        className="sticky top-0 z-10 grid min-w-[800px] grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(16rem,3fr)_8rem_6rem_7rem] gap-3 border-b border-border-subtle bg-surface-primary px-4 py-3 text-sm font-semibold text-text-primary"
        role="row"
      >
        <span role="columnheader">Title</span>
        <span role="columnheader">Author</span>
        <span role="columnheader">Description</span>
        <span role="columnheader">Updated</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Action</span>
      </div>
      {loading && <p className="p-6 text-text-muted">Loading Kiwix library…</p>}
      {!loading && items.length === 0 && <p className="p-6 text-text-muted">No records found</p>}
      <div
        className="relative min-w-[800px]"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        role="rowgroup"
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          const expanded = item.id === expandedId
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full border-b border-border-subtle bg-surface-primary"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div
                className="grid grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(16rem,3fr)_8rem_6rem_7rem] items-center gap-3 px-4 py-2 text-sm text-text-primary"
                role="row"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`zim-details-${item.id}`}
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className="min-w-0 text-left font-medium hover:text-desert-green focus-visible:outline focus-visible:outline-2"
                  title={expanded ? 'Collapse details' : 'Expand details'}
                >
                  <span aria-hidden="true" className="mr-2">
                    {expanded ? '▾' : '▸'}
                  </span>
                  {item.title}
                </button>
                <span className="truncate text-text-muted" title={item.author}>
                  {item.author}
                </span>
                <span className="truncate text-text-muted" title={item.summary}>
                  {item.summary}
                </span>
                <span className="text-text-muted">{formattedCatalogDate(item.updated) ?? '—'}</span>
                <span className="text-text-muted">{formatBytes(item.size_bytes)}</span>
                <StyledButton icon="IconDownload" onClick={() => onDownload(item)}>
                  Download
                </StyledButton>
              </div>
              {expanded && (
                <div
                  id={`zim-details-${item.id}`}
                  className="border-t border-border-subtle bg-surface-secondary px-5 py-4 text-sm text-text-primary"
                >
                  <p className="mb-4 whitespace-normal">{item.summary}</p>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                    {item.author && <Detail label="Author" value={item.author} />}
                    {item.publisher && <Detail label="Publisher" value={item.publisher} />}
                    {item.language && <Detail label="Language" value={item.language} />}
                    {item.category && <Detail label="Category" value={item.category} />}
                    {item.article_count != null && (
                      <Detail label="Articles" value={item.article_count.toLocaleString()} />
                    )}
                    {item.media_count != null && (
                      <Detail label="Media" value={item.media_count.toLocaleString()} />
                    )}
                    {formattedCatalogDate(item.issued) && (
                      <Detail label="Issued" value={formattedCatalogDate(item.issued)!} />
                    )}
                    <Detail label="Size" value={formatBytes(item.size_bytes)} />
                  </div>
                  {item.tags && (
                    <p className="mt-4 text-text-muted">
                      Tags: {item.tags.split(';').filter(Boolean).join(', ')}
                    </p>
                  )}
                  <p className="mt-2 break-all text-text-muted">File: {item.file_name}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-text-muted">{label}: </span>
      <span>{value}</span>
    </div>
  )
}
