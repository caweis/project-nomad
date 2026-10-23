import { CustomLibraryError, ZimService } from '#services/zim_service'
import {
  assertNotPrivateUrl,
  downloadCategoryTierValidator,
  filenameParamValidator,
  remoteDownloadWithMetadataValidator,
  selectWikipediaValidator,
} from '#validators/common'
import {
  addCustomLibraryValidator,
  browseCustomLibraryValidator,
  customLibraryIdValidator,
  listRemoteZimValidator,
} from '#validators/zim'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class ZimController {
  constructor(private zimService: ZimService) {}

  async list({}: HttpContext) {
    return await this.zimService.list()
  }

  async listRemote({ request }: HttpContext) {
    const payload = await request.validateUsing(listRemoteZimValidator)
    const { start = 0, count = 12, query, language } = payload
    return await this.zimService.listRemote({ start, count, query, language })
  }

  async listCatalogLanguages({}: HttpContext) {
    return { languages: await this.zimService.listCatalogLanguages() }
  }

  async downloadRemote({ request }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadWithMetadataValidator)
    assertNotPrivateUrl(payload.url)
    const { filename, jobId } = await this.zimService.downloadRemote(payload.url)

    return {
      message: 'Download started successfully',
      filename,
      jobId,
      url: payload.url,
    }
  }

  async listCuratedCategories({}: HttpContext) {
    return await this.zimService.listCuratedCategories()
  }

  async downloadCategoryTier({ request }: HttpContext) {
    const payload = await request.validateUsing(downloadCategoryTierValidator)
    const resources = await this.zimService.downloadCategoryTier(
      payload.categorySlug,
      payload.tierSlug
    )

    return {
      message: 'Download started successfully',
      categorySlug: payload.categorySlug,
      tierSlug: payload.tierSlug,
      resources,
    }
  }

  async delete({ request, response }: HttpContext) {
    const payload = await request.validateUsing(filenameParamValidator)

    try {
      await this.zimService.delete(payload.params.filename)
    } catch (error) {
      if (error.message === 'not_found') {
        return response.status(404).send({
          message: `ZIM file with key ${payload.params.filename} not found`,
        })
      }
      throw error // Re-throw any other errors and let the global error handler catch
    }

    return {
      message: 'ZIM file deleted successfully',
    }
  }

  // Wikipedia selector endpoints

  async getWikipediaState({}: HttpContext) {
    return this.zimService.getWikipediaState()
  }

  async selectWikipedia({ request }: HttpContext) {
    const payload = await request.validateUsing(selectWikipediaValidator)
    return this.zimService.selectWikipedia(payload.optionId)
  }

  async listCustomLibraries() {
    return this.zimService.listCustomLibraries()
  }

  async addCustomLibrary({ request, response }: HttpContext) {
    const payload = await request.validateUsing(addCustomLibraryValidator)
    try {
      const library = await this.zimService.addCustomLibrary(payload.name, payload.base_url)
      return response.status(201).send({ library })
    } catch (error) {
      if (error instanceof CustomLibraryError) {
        return response.status(error.status).send({ message: error.message })
      }
      throw error
    }
  }

  async removeCustomLibrary({ request, response }: HttpContext) {
    const payload = await request.validateUsing(customLibraryIdValidator)
    try {
      await this.zimService.removeCustomLibrary(payload.params.id)
      return { message: 'Library source removed' }
    } catch (error) {
      if (error instanceof CustomLibraryError) {
        return response.status(error.status).send({ message: error.message })
      }
      throw error
    }
  }

  async browseCustomLibrary({ request, response }: HttpContext) {
    const payload = await request.validateUsing(browseCustomLibraryValidator)
    try {
      return await this.zimService.browseCustomLibrary(payload.params.id, payload.path)
    } catch (error) {
      if (error instanceof CustomLibraryError) {
        return response.status(error.status).send({ message: error.message })
      }
      throw error
    }
  }
}
