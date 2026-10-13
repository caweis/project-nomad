import { test } from '@japa/runner'
import { filenameFromDownloadUrl } from '../../app/utils/download_filename.js'
import { RunDownloadJob } from '../../app/jobs/run_download_job.js'
import { ZimService } from '../../app/services/zim_service.js'
import { MapService } from '../../app/services/map_service.js'

test.group('download URL filenames', () => {
  test('ignores query strings and fragments on signed content URLs', ({ assert }) => {
    assert.equal(
      filenameFromDownloadUrl('https://example.org/library/file.zim?token=abc#part'),
      'file.zim'
    )
    assert.equal(
      filenameFromDownloadUrl('https://example.org/maps/region.pmtiles?expires=123'),
      'region.pmtiles'
    )
    assert.equal(
      filenameFromDownloadUrl(
        'https://example.org/maps/region.pmtiles?token=https://other.example/key'
      ),
      'region.pmtiles'
    )
  })

  test('returns null when the URL has no final path component or is malformed', ({ assert }) => {
    assert.isNull(filenameFromDownloadUrl('https://example.org/library/'))
    assert.isNull(filenameFromDownloadUrl('not a URL'))
  })
})

test('signed ZIM and map URLs dispatch to filenames without query strings', async ({ assert }) => {
  const originalGetActiveByUrl = RunDownloadJob.getActiveByUrl
  const originalDispatch = RunDownloadJob.dispatch
  const dispatched: { url: string; filepath: string }[] = []

  ;(RunDownloadJob as any).getActiveByUrl = async () => undefined
  ;(RunDownloadJob as any).dispatch = async (params: { url: string; filepath: string }) => {
    dispatched.push(params)
    return { job: { id: 'test-job' } }
  }

  try {
    const zim = await new ZimService({} as any).downloadRemote(
      'https://example.org/files/example_2026-10.zim?token=secret'
    )
    const mapService = new MapService()
    ;(mapService as any).ensureBaseAssets = async () => true
    const map = await mapService.downloadRemote(
      'https://example.org/maps/region_2026-10.pmtiles?token=secret'
    )

    assert.equal(zim.filename, 'example_2026-10.zim')
    assert.equal(map.filename, 'region_2026-10.pmtiles')
    assert.isTrue(dispatched[0].filepath.endsWith('/example_2026-10.zim'))
    assert.isTrue(dispatched[1].filepath.endsWith('/region_2026-10.pmtiles'))
  } finally {
    ;(RunDownloadJob as any).getActiveByUrl = originalGetActiveByUrl
    ;(RunDownloadJob as any).dispatch = originalDispatch
  }
})
