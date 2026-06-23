import { SystemService } from '#services/system_service'
import { ZimService } from '#services/zim_service'
import { DrugReferenceService } from '#services/drug_reference_service'
import { CollectionManifestService } from '#services/collection_manifest_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

@inject()
export default class EasySetupController {
  constructor(
    private systemService: SystemService,
    private zimService: ZimService,
    private drugReferenceService: DrugReferenceService
  ) {}

  async index({ inertia }: HttpContext) {
    const services = await this.systemService.getServices({ installedOnly: false })
    // FDA Drug Reference is a content dataset, not a registered service, so the
    // wizard surfaces it as a bespoke card. Pass the row count (installed-state
    // gate) + live ingest status (in-progress state) the same way
    // DrugReferenceController.index does.
    const [drugRowCount, drugIngestStatus] = await Promise.all([
      this.drugReferenceService.rowCount(),
      this.drugReferenceService.getIngestStatus(),
    ])
    return inertia.render('easy-setup/index', {
      system: {
        services: services,
      },
      // Drives backend-aware copy in the wizard (e.g. the AI Models step notes
      // that chat runs on Apple MLX, with Ollama models coexisting). Mirrors the
      // pattern in settings_controller; defaults to 'ollama' when unset.
      aiBackend: env.get('NOMAD_AI_BACKEND') ?? 'ollama',
      drugReference: {
        rowCount: drugRowCount,
        ingestStatus: drugIngestStatus,
      },
    })
  }

  async complete({ inertia }: HttpContext) {
    return inertia.render('easy-setup/complete')
  }

  async listCuratedCategories({}: HttpContext) {
    return await this.zimService.listCuratedCategories()
  }

  async refreshManifests({}: HttpContext) {
    const manifestService = new CollectionManifestService()
    const [zimChanged, mapsChanged, wikiChanged] = await Promise.all([
      manifestService.fetchAndCacheSpec('zim_categories'),
      manifestService.fetchAndCacheSpec('maps'),
      manifestService.fetchAndCacheSpec('wikipedia'),
    ])

    return {
      success: true,
      changed: {
        zim_categories: zimChanged,
        maps: mapsChanged,
        wikipedia: wikiChanged,
      },
    }
  }
}
