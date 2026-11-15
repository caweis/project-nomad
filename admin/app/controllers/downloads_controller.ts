import type { HttpContext } from '@adonisjs/core/http'
import { DownloadService } from '#services/download_service'
import { downloadJobsByFiletypeSchema } from '#validators/download'
import { inject } from '@adonisjs/core'

@inject()
export default class DownloadsController {
  constructor(private downloadService: DownloadService) {}

  async cancelJob({ params, response }: HttpContext) {
    const result = await this.downloadService.cancelJob(params.jobId)
    return response.status(result.success ? 200 : 409).send(result)
  }

  async removeJob({ params, response }: HttpContext) {
    const result = await this.downloadService.removeJob(params.jobId)
    return response.status(result.success ? 200 : 409).send(result)
  }

  async index() {
    return this.downloadService.listDownloadJobs()
  }

  async filetype({ request }: HttpContext) {
    const payload = await request.validateUsing(downloadJobsByFiletypeSchema)
    return this.downloadService.listDownloadJobs(payload.params.filetype)
  }

  // Retry a failed download by re-dispatching it. Ported from upstream #1059.
  async retryJob({ params }: HttpContext) {
    return this.downloadService.retryFailedJob(params.jobId)
  }
}
