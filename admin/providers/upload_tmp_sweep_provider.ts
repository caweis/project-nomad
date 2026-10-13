import { tmpdir } from 'node:os'
import logger from '@adonisjs/core/services/logger'
import type { ApplicationService } from '@adonisjs/core/types'
import { sweepStaleUploads } from '../app/utils/stale_uploads.js'

const SWEEP_EVERY_MS = 60 * 60 * 1000

/**
 * Clears out abandoned upload files from the temp folder: once at startup, then
 * once an hour. See app/utils/stale_uploads.ts for what they are and why nothing
 * else removes them.
 */
export default class UploadTmpSweepProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    // Only in the web (HTTP server) environment: not for ace commands or tests.
    if (this.app.getEnvironment() !== 'web') return

    const sweep = async () => {
      try {
        const removed = await sweepStaleUploads(tmpdir())
        if (removed > 0) {
          logger.info(`[UploadTmpSweep] Removed ${removed} abandoned upload file(s)`)
        }
      } catch (error) {
        logger.warn(
          `[UploadTmpSweep] Sweep failed: ${error instanceof Error ? error.message : error}`
        )
      }
    }

    // Past synchronous boot, so a slow folder never holds up startup.
    setImmediate(sweep)
    setInterval(sweep, SWEEP_EVERY_MS).unref()
  }
}
