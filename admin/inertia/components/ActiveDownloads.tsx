import useDownloads, { useDownloadsProps } from '~/hooks/useDownloads'
import HorizontalBarChart from './HorizontalBarChart'
import { extractFileName } from '~/lib/util'
import StyledSectionHeader from './StyledSectionHeader'
import { IconAlertTriangle, IconReload } from '@tabler/icons-react'
import api from '~/lib/api'

interface ActiveDownloadProps {
  filetype?: useDownloadsProps['filetype']
  withHeader?: boolean
}

const ActiveDownloads = ({ filetype, withHeader = false }: ActiveDownloadProps) => {
  const { data: downloads, invalidate } = useDownloads({ filetype })

  // Retry a failed download, then refresh the list (#1059).
  const handleRetry = async (jobId: string) => {
    await api.retryDownloadJob(jobId)
    invalidate()
  }

  return (
    <>
      {withHeader && <StyledSectionHeader title="Active Downloads" className="mt-12 mb-4" />}
      <div className="space-y-4">
        {downloads && downloads.length > 0 ? (
          downloads.map((download) => (
            <div
              key={download.jobId}
              className={`bg-desert-white rounded-lg p-4 border shadow-sm hover:shadow-lg transition-shadow ${
                download.status === 'failed'
                  ? 'border-red-300'
                  : 'border-desert-stone-light'
              }`}
            >
              {download.status === 'failed' ? (
                <div className="flex items-center gap-2">
                  <IconAlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {extractFileName(download.filepath) || download.url}
                    </p>
                    <p className="text-xs text-red-600 mt-0.5">
                      Download failed{download.failedReason ? `: ${download.failedReason}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetry(download.jobId)}
                    className="flex-shrink-0 inline-flex items-center gap-1 rounded border border-desert-green text-desert-green hover:bg-desert-green hover:text-white transition-colors px-2.5 py-1 text-xs font-medium"
                  >
                    <IconReload size={14} />
                    Retry
                  </button>
                </div>
              ) : (
                <HorizontalBarChart
                  items={[
                    {
                      label: extractFileName(download.filepath) || download.url,
                      value: download.progress,
                      total: '100%',
                      used: `${download.progress}%`,
                      type: download.filetype,
                    },
                  ]}
                />
              )}
            </div>
          ))
        ) : (
          <p className="text-text-muted">No active downloads</p>
        )}
      </div>
    </>
  )
}

export default ActiveDownloads
