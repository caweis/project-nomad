import useEmbedJobs from '~/hooks/useEmbedJobs'
import HorizontalBarChart from './HorizontalBarChart'
import StyledSectionHeader from './StyledSectionHeader'

interface ActiveEmbedJobsProps {
  withHeader?: boolean
}

const ActiveEmbedJobs = ({ withHeader = false }: ActiveEmbedJobsProps) => {
  const { data: jobs } = useEmbedJobs()

  return (
    <>
      {withHeader && (
        <StyledSectionHeader title="Processing Queue" className="mt-12 mb-4" />
      )}
      <div className="space-y-4">
        {jobs && jobs.length > 0 ? (
          jobs.map((job) =>
            job.status === 'failed' ? (
              <div
                key={job.jobId}
                className="bg-red-50 rounded-lg p-4 border border-red-200 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-red-800 break-all">{job.fileName}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-red-200 text-red-900 font-mono shrink-0">
                    failed
                  </span>
                </div>
                <p className="mt-1 text-sm text-red-700 break-words">
                  {job.failedReason || 'Embedding failed. Re-run the sync to retry.'}
                </p>
              </div>
            ) : (
              <div
                key={job.jobId}
                className="bg-desert-white rounded-lg p-4 border border-desert-stone-light shadow-sm hover:shadow-lg transition-shadow"
              >
                <HorizontalBarChart
                  items={[
                    {
                      label: job.fileName,
                      value: job.progress,
                      total: '100%',
                      used: `${job.progress}%`,
                      type: job.status,
                    },
                  ]}
                />
              </div>
            )
          )
        ) : (
          <p className="text-text-muted">No files are currently being processed</p>
        )}
      </div>
    </>
  )
}

export default ActiveEmbedJobs
