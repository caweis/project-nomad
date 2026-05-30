import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { StlScannerService } from '#services/stl_scanner_service'

/**
 * `node ace stl:reindex` — scan the Workshop STL library directory and bring
 * the `stl_files` table into agreement with what's actually on disk.
 *
 * Walks ${NOMAD_DATA_ROOT}/storage/stl-library/, hashes the first 1 MB of
 * each file for change detection, upserts/inserts/deletes DB rows, and
 * generates PNG thumbnails via stl-thumb for any row that doesn't have one
 * (skipping rows previously marked thumbnail_failed=true so unreadable
 * files don't cost CPU forever).
 *
 * Triggered by:
 *   • Manual run from the admin container shell:
 *       docker exec -it nomad_admin node ace stl:reindex
 *   • The Workshop UI's "Rescan library" button (controller proxies through
 *     to StlScannerService directly — same code path)
 *   • The `nomad stl import <dir>` CLI subcommand on the host, which copies
 *     files into the library dir and then triggers this command
 *
 * Safe to run while the library is in use — the upsert is idempotent and
 * file-locking is read-only.
 */
export default class StlReindex extends BaseCommand {
  static commandName = 'stl:reindex'
  static description =
    'Rescan the Workshop STL library on disk and update the index (insert new files, ' +
    'update changed files, remove rows for deleted files, generate missing thumbnails).'

  static options: CommandOptions = {
    startApp: true,  // need the DB connection
  }

  async run() {
    this.logger.info('Starting STL library reindex…')

    const scanner = new StlScannerService()
    const result = await scanner.scan()

    if (!result.available) {
      this.logger.warning(
        'Library root unavailable — data drive likely disconnected. Nothing scanned.'
      )
      return
    }

    this.logger.success(
      `Scan complete: ${result.added} added, ${result.updated} updated, ` +
        `${result.unchanged} unchanged, ${result.orphaned} orphan(s) removed`
    )
    if (result.thumbnails_generated + result.thumbnails_failed > 0) {
      this.logger.info(
        `Thumbnails: ${result.thumbnails_generated} generated, ` +
          `${result.thumbnails_failed} failed (failed rows skipped on future scans)`
      )
    }
  }
}
