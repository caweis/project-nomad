import { existsSync, createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join, extname } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import StlFile from '#models/stl_file'
import KVStore from '#models/kv_store'
import { StlScannerService } from '#services/stl_scanner_service'
import {
  listStlFilesValidator,
  updateStlFileValidator,
} from '#validators/stl_library'
import { CATEGORY_LABELS, STL_CATEGORIES, STL_DIFFICULTIES, STL_MATERIALS } from '../../types/stl_library.js'
import type { StlFileSlim } from '../../types/stl_library.js'

/**
 * Workshop / Offline STL Library — HTTP boundary.
 *
 * Renders two Inertia pages (list + detail) and a small JSON API for
 * inline metadata edits, library rescans, file download, thumbnail serving,
 * and rights-modal acceptance.
 *
 * The data drive holding the library can be unplugged. When the library
 * root is missing on disk, list/detail render an Inertia "unavailable"
 * panel (same pattern as Kiwix when its drive is out) — no 500s, no
 * exception traces leaking to the UI.
 */
export default class WorkshopController {
  /**
   * GET /workshop — list page.
   * Server-side renders Inertia with the filtered, paginated rows and the
   * full enum lists so the filter sidebar doesn't need a separate fetch.
   */
  async index({ inertia, request }: HttpContext) {
    const filters = await request.validateUsing(listStlFilesValidator)

    if (!existsSync(StlScannerService.LIBRARY_ROOT)) {
      return inertia.render('workshop/index', {
        unavailable: {
          available: false,
          reason: 'drive_disconnected',
          library_root: StlScannerService.LIBRARY_ROOT,
        },
        files: [],
        pagination: null,
        filters,
        enums: this.enumsForUi(),
        rights_acknowledged: await this.rightsAcknowledged(),
      })
    }

    const page = filters.page ?? 1
    const perPage = filters.per_page ?? 48

    const query = StlFile.query()

    if (filters.category) query.where('category', filters.category)
    if (filters.material) query.where('material', filters.material)
    if (filters.difficulty) query.where('difficulty', filters.difficulty)
    if (filters.pending_metadata === true) query.where('metadata_pending', true)
    if (filters.pending_metadata === false) query.where('metadata_pending', false)
    if (filters.search) {
      const term = `%${filters.search}%`
      query.where((q) => {
        q.whereILike('name', term).orWhereILike('description', term)
      })
    }

    // Default sort: pending-metadata first (those need user attention),
    // then newest. Once the user has filled metadata, the file falls into
    // the standard newest-first ordering.
    query.orderBy('metadata_pending', 'desc').orderBy('added_at', 'desc')

    const paginated = await query.paginate(page, perPage)

    const files: StlFileSlim[] = paginated.all().map((row) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      category: row.category,
      material: row.material,
      print_time_minutes: row.print_time_minutes,
      difficulty: row.difficulty,
      thumbnail_path: row.thumbnail_path,
      thumbnail_failed: row.thumbnail_failed,
      metadata_pending: row.metadata_pending,
      file_size_bytes: row.file_size_bytes,
    }))

    return inertia.render('workshop/index', {
      unavailable: null,
      files,
      pagination: {
        total: paginated.total,
        per_page: paginated.perPage,
        current_page: paginated.currentPage,
        last_page: paginated.lastPage,
      },
      filters,
      enums: this.enumsForUi(),
      rights_acknowledged: await this.rightsAcknowledged(),
    })
  }

  /**
   * GET /workshop/:id — detail page (also acts as the metadata edit form).
   */
  async show({ inertia, params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.notFound({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row) {
      return response.notFound({ error: 'STL file not found' })
    }

    return inertia.render('workshop/show', {
      file: {
        id: row.id,
        path: row.path,
        name: row.name,
        category: row.category,
        tags: row.tags ?? [],
        material: row.material,
        print_time_minutes: row.print_time_minutes,
        infill_pct: row.infill_pct,
        difficulty: row.difficulty,
        description: row.description,
        source_url: row.source_url,
        license: row.license,
        thumbnail_path: row.thumbnail_path,
        thumbnail_failed: row.thumbnail_failed,
        metadata_pending: row.metadata_pending,
        file_size_bytes: row.file_size_bytes,
        file_hash: row.file_hash,
        added_at: row.added_at?.toISO(),
        last_indexed_at: row.last_indexed_at?.toISO(),
      },
      file_available: existsSync(join(StlScannerService.LIBRARY_ROOT, row.path)),
      enums: this.enumsForUi(),
      rights_acknowledged: await this.rightsAcknowledged(),
    })
  }

  /**
   * PATCH /api/workshop/files/:id — update metadata.
   * Recomputes metadata_pending after the update so the row exits the
   * pending state automatically once required fields are filled.
   */
  async update({ params, request, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row) return response.notFound({ error: 'STL file not found' })

    const payload = await request.validateUsing(updateStlFileValidator)

    if (payload.name !== undefined) row.name = payload.name
    if (payload.category !== undefined) row.category = payload.category
    if (payload.tags !== undefined) row.tags = payload.tags
    if (payload.material !== undefined) row.material = payload.material
    if (payload.print_time_minutes !== undefined) row.print_time_minutes = payload.print_time_minutes
    if (payload.infill_pct !== undefined) row.infill_pct = payload.infill_pct
    if (payload.difficulty !== undefined) row.difficulty = payload.difficulty
    if (payload.description !== undefined) row.description = payload.description
    if (payload.source_url !== undefined) row.source_url = payload.source_url
    if (payload.license !== undefined) row.license = payload.license

    row.metadata_pending = !StlFile.isMetadataComplete({
      name: row.name,
      material: row.material,
      print_time_minutes: row.print_time_minutes,
      difficulty: row.difficulty,
    })

    await row.save()

    return { success: true, metadata_pending: row.metadata_pending }
  }

  /**
   * DELETE /api/workshop/files/:id — remove a row AND delete the file on
   * disk. Destructive — the UI confirms before calling this. The next
   * scan would have removed the orphan row anyway; this is the
   * eager-delete UX.
   */
  async destroy({ params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row) return response.notFound({ error: 'STL file not found' })

    const fileAbs = join(StlScannerService.LIBRARY_ROOT, row.path)
    const thumbAbs = row.thumbnail_path
      ? join(StlScannerService.LIBRARY_ROOT, row.thumbnail_path)
      : null

    // Delete file first; tolerate already-missing files.
    await fs.unlink(fileAbs).catch((err) => {
      if (err.code !== 'ENOENT') {
        logger.warn(`[WorkshopController] couldn't delete ${fileAbs}: ${err.message}`)
      }
    })
    if (thumbAbs) {
      await fs.unlink(thumbAbs).catch(() => {})
    }

    await row.delete()
    return { success: true }
  }

  /**
   * POST /api/workshop/scan — trigger a full library rescan.
   * Returns the scan summary so the UI can show "X added, Y updated, ..."
   */
  async scan({ response }: HttpContext) {
    const scanner = new StlScannerService()
    try {
      const result = await scanner.scan()
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[WorkshopController] scan failed: ${msg}`)
      return response.internalServerError({ error: msg })
    }
  }

  /**
   * GET /api/workshop/files/:id/download — stream the binary STL/3MF.
   * The browser handles the download dialog via Content-Disposition.
   */
  async download({ params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row) return response.notFound({ error: 'STL file not found' })

    const abs = join(StlScannerService.LIBRARY_ROOT, row.path)
    if (!existsSync(abs)) {
      return response.notFound({ error: 'file missing on disk — drive disconnected?' })
    }

    const ext = extname(row.path).toLowerCase()
    const mime = ext === '.3mf' ? 'model/3mf' : 'model/stl'
    const filename = `${row.name}${ext}`

    response.header('Content-Type', mime)
    response.header('Content-Disposition', `attachment; filename="${this.safeFilename(filename)}"`)
    response.header('Content-Length', String(row.file_size_bytes))
    return response.stream(createReadStream(abs))
  }

  /**
   * GET /api/workshop/files/:id/thumbnail — stream the PNG preview.
   * Returns 404 if the thumbnail hasn't been generated yet OR if rendering
   * failed (the UI shows a generic SVG fallback in either case).
   */
  async thumbnail({ params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row || !row.thumbnail_path) {
      return response.notFound({ error: 'no thumbnail' })
    }

    const abs = join(StlScannerService.LIBRARY_ROOT, row.thumbnail_path)
    if (!existsSync(abs)) {
      return response.notFound({ error: 'thumbnail missing on disk' })
    }

    response.header('Content-Type', 'image/png')
    response.header('Cache-Control', 'private, max-age=3600')
    return response.stream(createReadStream(abs))
  }

  /**
   * POST /api/workshop/acknowledge-rights — flip the kv_store flag that
   * dismisses the rights modal on subsequent visits. Idempotent.
   */
  async acknowledgeRights({}: HttpContext) {
    const existing = await KVStore.findBy('key', 'workshop.rightsAcknowledged')
    if (existing) {
      existing.value = 'true'
      await existing.save()
    } else {
      await KVStore.create({ key: 'workshop.rightsAcknowledged', value: 'true' })
    }
    return { success: true }
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async rightsAcknowledged(): Promise<boolean> {
    const row = await KVStore.findBy('key', 'workshop.rightsAcknowledged')
    return row?.value === 'true'
  }

  private enumsForUi() {
    return {
      categories: STL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
      materials: [...STL_MATERIALS],
      difficulties: [...STL_DIFFICULTIES],
    }
  }

  /**
   * Strip characters Content-Disposition treats specially. The user's `name`
   * field is freeform, so they might enter "foo/bar baz.stl" — those slashes
   * confuse browsers and could be a path-traversal vector if reflected back.
   */
  private safeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200)
  }
}
