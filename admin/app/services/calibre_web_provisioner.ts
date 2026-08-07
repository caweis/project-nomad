import { existsSync } from 'node:fs'
import { mkdir, chmod, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import * as tar from 'tar'
import type Docker from 'dockerode'
import logger from '@adonisjs/core/services/logger'
import { CALIBRE_WEB_STORAGE_PATH } from '../utils/fs.js'
import {
  decideProvisionSteps,
  type CalibreProvisionState,
  type CalibreProvisionStep,
} from '../utils/calibre_provision_decision.js'

/**
 * Auto-provisions the eBook Library (Calibre-Web) so a fresh install opens as
 * a working, uploadable library instead of the first-run wizard — which is a
 * dead end out of the box, because calibre-web refuses a library directory
 * that has no metadata.db and cannot create one itself (verified at 0.6.26).
 *
 * Mirrors the pattern the LinuxServer image itself uses:
 * 1. seed-library-db — copy the empty-library template the calibre-web app
 *    tree ships at /app/calibre-web/library/metadata.db out of the pinned
 *    image (no-start container + archive read). Runtime copy from the already
 *    distributed GPL container, so nothing GPL enters this Apache-2.0 repo,
 *    and the template always matches the exact app version.
 * 2. materialize-app-db — one-shot `python3 cps.py -d` run (updater dry-run:
 *    full init incl. the admin/admin123 user AND the load-bearing Guest row,
 *    then exit). Never hand-write app.db: a pre-existing file makes the app
 *    skip user seeding, and a missing Guest row errors every request.
 * 3. point-library — UPDATE the settings row: config_calibre_dir='/books',
 *    config_uploading=1. With metadata.db present, db_configured computes
 *    true at boot and the wizard gate never fires.
 *
 * Idempotent, and never touches an install whose config_calibre_dir is set
 * (see decideProvisionSteps). All failures throw; the caller decides whether
 * to fail open.
 */
export class CalibreWebProvisioner {
  // Admin-container view of the /config bind (same mount the Grocy
  // provisioner and STL scanner rely on).
  static readonly CONFIG_DIR = join(process.cwd(), CALIBRE_WEB_STORAGE_PATH)
  static readonly BOOKS_DIR = join(CalibreWebProvisioner.CONFIG_DIR, 'books')

  // Where the calibre-web app tree keeps its empty-library template inside
  // the LSIO image (tag tarball untarred to /app/calibre-web).
  private static readonly TEMPLATE_PATH = '/app/calibre-web/library/metadata.db'
  private static readonly ONE_SHOT_TIMEOUT_MS = 120_000

  static readState(): CalibreProvisionState {
    const appDbPath = join(CalibreWebProvisioner.CONFIG_DIR, 'app.db')
    const libraryDbExists = existsSync(join(CalibreWebProvisioner.BOOKS_DIR, 'metadata.db'))
    const appDbExists = existsSync(appDbPath)

    let configCalibreDir: string | null = null
    if (appDbExists) {
      try {
        const db = new Database(appDbPath, { readonly: true, timeout: 5000 })
        try {
          const row = db.prepare('SELECT config_calibre_dir FROM settings LIMIT 1').get() as
            | { config_calibre_dir: string | null }
            | undefined
          configCalibreDir = row?.config_calibre_dir || null
        } finally {
          db.close()
        }
      } catch (error) {
        // Missing table or unreadable db: treat as unconfigured. point-library
        // upserts the row, and calibre-web's own migration tolerates it.
        logger.warn(
          `[CalibreWebProvisioner] Could not read settings from app.db (treating as unconfigured): ${error instanceof Error ? error.message : error}`
        )
      }
    }

    return { libraryDbExists, appDbExists, configCalibreDir }
  }

  /**
   * Run whatever provisioning the current on-disk state calls for.
   * `hostConfigDir` is the HOST-side path of the /config bind (needed for the
   * one-shot container, which mounts it the same way the real container will).
   */
  static async provision(options: {
    docker: Docker
    image: string
    hostConfigDir: string
  }): Promise<{ steps: CalibreProvisionStep[] }> {
    const steps = decideProvisionSteps(CalibreWebProvisioner.readState())

    for (const step of steps) {
      if (step === 'seed-library-db') {
        await CalibreWebProvisioner._seedLibraryDb(options.docker, options.image)
      } else if (step === 'materialize-app-db') {
        await CalibreWebProvisioner._materializeAppDb(
          options.docker,
          options.image,
          options.hostConfigDir
        )
      } else {
        CalibreWebProvisioner._pointLibrary()
      }
      logger.info(`[CalibreWebProvisioner] ${step} done`)
    }

    return { steps }
  }

  /** Copy the empty-library template out of the image without starting it. */
  private static async _seedLibraryDb(docker: Docker, image: string): Promise<void> {
    await mkdir(CalibreWebProvisioner.BOOKS_DIR, { recursive: true })

    const tmpDir = join(CalibreWebProvisioner.CONFIG_DIR, '.provision-tmp')
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })

    // Created, never started: getArchive works against the stopped container's
    // filesystem, so the image's s6 entrypoint never runs.
    const container = await docker.createContainer({ Image: image, Entrypoint: ['true'] })
    try {
      const stream = await container.getArchive({ path: CalibreWebProvisioner.TEMPLATE_PATH })
      await pipeline(stream, tar.x({ cwd: tmpDir }))
    } finally {
      await container.remove({ force: true }).catch(() => {})
    }

    const extracted = join(tmpDir, 'metadata.db')
    if (!existsSync(extracted)) {
      throw new Error(`library template not found in image at ${CalibreWebProvisioner.TEMPLATE_PATH}`)
    }

    const target = join(CalibreWebProvisioner.BOOKS_DIR, 'metadata.db')
    await rename(extracted, target)
    await rm(tmpDir, { recursive: true, force: true })

    // The container's app user (PUID, default 1000) must write here for
    // uploads; LSIO chowns /config on start but not the /books mount, and this
    // file is written as the admin's uid. World-writable is acceptable for a
    // LAN appliance volume that only this app consumes.
    await chmod(CalibreWebProvisioner.BOOKS_DIR, 0o777)
    await chmod(target, 0o666)
  }

  /** One-shot `cps.py -d`: calibre-web fully initializes app.db, then exits. */
  private static async _materializeAppDb(
    docker: Docker,
    image: string,
    hostConfigDir: string
  ): Promise<void> {
    const container = await docker.createContainer({
      Image: image,
      // Bypass the s6 entrypoint: run the app's init directly, the same
      // invocation LSIO's own first-run script uses.
      Entrypoint: ['python3', '/app/calibre-web/cps.py', '-d'],
      Env: ['CALIBRE_DBPATH=/config'],
      HostConfig: { Binds: [`${hostConfigDir}:/config`] },
    })
    try {
      await container.start()
      const waited = await Promise.race([
        container.wait(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('one-shot app.db init timed out')),
            CalibreWebProvisioner.ONE_SHOT_TIMEOUT_MS
          )
        ),
      ])
      if (waited.StatusCode !== 0) {
        throw new Error(`one-shot app.db init exited with code ${waited.StatusCode}`)
      }
    } finally {
      await container.remove({ force: true }).catch(() => {})
    }

    if (!existsSync(join(CalibreWebProvisioner.CONFIG_DIR, 'app.db'))) {
      throw new Error('one-shot init exited cleanly but app.db was not created')
    }
  }

  /** Point the (single-row) settings table at /books and enable uploads. */
  private static _pointLibrary(): void {
    const db = new Database(join(CalibreWebProvisioner.CONFIG_DIR, 'app.db'), { timeout: 5000 })
    try {
      db.pragma('busy_timeout = 5000')
      const row = db.prepare('SELECT id, config_calibre_dir FROM settings LIMIT 1').get() as
        | { id: number; config_calibre_dir: string | null }
        | undefined
      if (!row) {
        // Partial rows are safe: calibre-web's startup migration ALTER-adds
        // every other column with its default (verified at 0.6.26).
        db.prepare(
          "INSERT INTO settings (config_calibre_dir, config_uploading) VALUES ('/books', 1)"
        ).run()
      } else if (!row.config_calibre_dir) {
        db.prepare(
          "UPDATE settings SET config_calibre_dir = '/books', config_uploading = 1 WHERE id = ?"
        ).run(row.id)
      }
      // A non-empty config_calibre_dir here means someone configured the app
      // between readState and now — leave it alone.
    } finally {
      db.close()
    }
  }
}
