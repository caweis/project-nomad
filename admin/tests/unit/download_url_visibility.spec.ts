import { test } from '@japa/runner'
import { DownloadService } from '../../app/services/download_service.js'
import { RunDownloadJob } from '../../app/jobs/run_download_job.js'
import {
  downloadFailureForDisplay,
  downloadUrlOriginForLog,
} from '../../app/utils/download_url_log.js'

test('download log labels omit URL credentials and reject malformed URLs', ({ assert }) => {
  assert.equal(
    downloadUrlOriginForLog('https://user:password@example.org:8443/file.zim?token=secret#part'),
    'https://example.org:8443'
  )
  assert.equal(downloadUrlOriginForLog('not a URL'), '[invalid download URL]')
  assert.equal(downloadUrlOriginForLog('file:///tmp/file.zim'), '[invalid download URL]')
  assert.equal(
    downloadFailureForDisplay('This content is gated behind an entitlement key (HTTP 403).'),
    'This content requires an entitlement key. Check the hosted content key on this install.'
  )
})

test('retry keeps the original URL in the job while returning a safe status message', async ({
  assert,
}) => {
  const originalDispatch = RunDownloadJob.dispatch
  const url = 'https://user:password@example.org/file.zim?token=secret'
  let retriedUrl: string | undefined
  ;(RunDownloadJob as any).dispatch = async (params: { url: string }) => {
    retriedUrl = params.url
    return { job: { id: 'job-2' } }
  }

  const queueService = {
    getQueue(name: string) {
      return {
        async getJob() {
          return name === 'downloads'
            ? { data: { url, filepath: '/tmp/file.zim', filetype: 'zim' }, remove: async () => {} }
            : null
        },
      }
    },
  }

  try {
    const result = await new DownloadService(queueService as any).retryFailedJob('job-2')
    assert.equal(retriedUrl, url)
    assert.equal(result.message, 'Retrying download from https://example.org')
  } finally {
    ;(RunDownloadJob as any).dispatch = originalDispatch
  }
})

test('download status omits credentials and failed-job details', async ({ assert }) => {
  const queueService = {
    getQueue(name: string) {
      return {
        async getJobs() {
          if (name !== 'downloads') return []
          return [
            {
              id: 'job-1',
              data: {
                url: 'https://user:password@example.org/file.zim?token=secret',
                filepath: '/tmp/file.zim?token=secret',
                filetype: 'zim',
              },
              progress: 25,
              failedReason: 'Request failed for https://example.org/file.zim?token=secret',
            },
          ]
        },
      }
    },
  }

  const jobs = await new DownloadService(queueService as any).listDownloadJobs()
  assert.lengthOf(jobs, 1)
  assert.equal(jobs[0].url, 'https://example.org')
  assert.equal(jobs[0].filepath, 'file.zim')
  assert.equal(jobs[0].failedReason, 'Download failed. Retry or check the server logs.')
  assert.notInclude(JSON.stringify(jobs), 'secret')
  assert.notInclude(JSON.stringify(jobs), 'password')
})
