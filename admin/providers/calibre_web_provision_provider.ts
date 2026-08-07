import logger from '@adonisjs/core/services/logger'
import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Boot-time reconcile for the eBook Library (Calibre-Web): installs that
 * predate the 0.2.760 provisioner sit stranded at the first-run wizard, which
 * cannot complete on an empty books folder (calibre-web refuses a library dir
 * with no metadata.db and cannot create one). This provisions them the same
 * way a fresh install now gets provisioned, then restarts the container so it
 * re-reads its settings.
 *
 * No-op when the app is configured, not installed, or already provisioned.
 * Non-fatal on failure: the app just keeps showing its wizard.
 */
export default class CalibreWebProvisionProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    // Only run in the web (HTTP server) environment — skip for ace commands and tests
    if (this.app.getEnvironment() !== 'web') return

    // Defer past synchronous boot so DB connections and all providers are fully ready
    setImmediate(async () => {
      try {
        const { DockerService } = await import('#services/docker_service')
        const { provisioned } = await new DockerService().reconcileCalibreWebProvision()
        if (provisioned) {
          logger.info(
            '[CalibreWebProvisionProvider] eBook Library provisioned on startup (was stranded at the first-run wizard).'
          )
        }
      } catch (err: any) {
        logger.error(
          `[CalibreWebProvisionProvider] Startup provisioning failed (non-fatal): ${err.message}`
        )
      }
    })
  }
}
