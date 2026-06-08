import { existsSync, createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import StlFile from '#models/stl_file'
import KVStore from '#models/kv_store'
import { StlScannerService } from '#services/stl_scanner_service'
import { isLocalNetworkRequest } from '#middleware/local_network_only_middleware'
import {
  batchWorkshopValidator,
  listStlFilesValidator,
  updateStlFileValidator,
} from '#validators/stl_library'
import {
  CATEGORY_LABELS,
  STL_CATEGORIES,
  STL_DIFFICULTIES,
  STL_MATERIALS,
  WORKSHOP_FILE_TYPES,
} from '../../types/stl_library.js'
import type { StlCategory, StlFileSlim } from '../../types/stl_library.js'
import { sanitizeFilename } from '../utils/fs.js'
import { requiredFieldsPresent } from '../../util/workshop_batch.js'
import { classifyFileType } from '../../util/file_classification.js'

/**
 * MIME types served by the download endpoint, keyed by lowercase extension.
 * Falls back to application/octet-stream for anything not listed (shouldn't
 * happen — the upload validator only accepts known types, but defensive).
 */
const DOWNLOAD_MIME_MAP: Record<string, string> = {
  '.stl': 'model/stl',
  '.3mf': 'model/3mf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // CAD: no standard MIME; browser downloads as a binary.
  '.step': 'application/octet-stream',
  '.stp': 'application/octet-stream',
  '.dxf': 'application/octet-stream',
  '.dwg': 'application/octet-stream',
  '.f3d': 'application/octet-stream',
  '.scad': 'application/octet-stream',
}

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

    const uploadCheck = isLocalNetworkRequest(request)

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
        upload_permitted: uploadCheck.permitted,
        upload_permitted_reason: uploadCheck.reason ?? null,
      })
    }

    const page = filters.page ?? 1
    const perPage = filters.per_page ?? 48

    const query = StlFile.query()

    if (filters.file_type) query.where('file_type', filters.file_type)
    if (filters.category) query.where('category', filters.category)
    if (filters.material) query.where('material', filters.material)
    if (filters.difficulty) query.where('difficulty', filters.difficulty)
    if (filters.pending_metadata === true) query.where('metadata_pending', true)
    if (filters.pending_metadata === false) query.where('metadata_pending', false)
    if (filters.search) {
      const term = `%${filters.search}%`
      query.where((q) => {
        q.whereILike('name', term)
          .orWhereILike('description', term)
          .orWhereILike('pdf_text_extract', term)
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
      file_type: (row.file_type ?? 'stl') as StlFileSlim['file_type'],
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
      upload_permitted: uploadCheck.permitted,
      upload_permitted_reason: uploadCheck.reason ?? null,
    })
  }

  /**
   * GET /workshop/:id — detail page (also acts as the metadata edit form).
   *
   * For PDF files: if the pdf-pages/{id}/ directory doesn't exist or is empty,
   * generatePdfPagePreviews is called lazily so the detail view gets page images
   * on first visit without waiting for a full scan.
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

    // Lazy PDF page preview generation — only if the file is on disk and no
    // pages have been rendered yet. Non-blocking on error (detail page still loads).
    if ((row.file_type ?? '') === 'pdf') {
      const fileAbs = join(StlScannerService.LIBRARY_ROOT, row.path)
      if (existsSync(fileAbs)) {
        const pageDir = join(
          StlScannerService.LIBRARY_ROOT,
          StlScannerService.THUMBNAIL_DIR,
          'pdf-pages',
          String(id)
        )
        let needsGenerate = true
        try {
          const entries = await fs.readdir(pageDir)
          if (entries.length > 0) needsGenerate = false
        } catch {
          // Directory doesn't exist yet — generate
        }
        if (needsGenerate) {
          try {
            const scanner = new StlScannerService()
            await scanner.generatePdfPagePreviews(id, fileAbs)
          } catch (err) {
            logger.warn(
              `[WorkshopController] lazy PDF page preview failed for id=${id}: ${
                err instanceof Error ? err.message : String(err)
              }`
            )
          }
        }
      }
    }

    return inertia.render('workshop/show', {
      file: {
        id: row.id,
        path: row.path,
        name: row.name,
        file_type: (row.file_type ?? 'stl') as StlFileSlim['file_type'],
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
      // Pass a boolean flag rather than the full 20 KB text in the page payload.
      // The frontend lazy-fetches /api/workshop/files/:id/pdf-text when the
      // disclosure is opened (spec open-q #2 — lazy fetch).
      // Gated on file_type === 'pdf' so non-PDF rows never advertise a text extract.
      has_pdf_text:
        row.file_type === 'pdf' &&
        typeof row.pdf_text_extract === 'string' &&
        row.pdf_text_extract.length > 0,
      file_available: existsSync(join(StlScannerService.LIBRARY_ROOT, row.path)),
      enums: this.enumsForUi(),
      rights_acknowledged: await this.rightsAcknowledged(),
    })
  }

  /**
   * GET /api/workshop/files/:id/pdf-page/:page
   *
   * Serves a single PDF page preview PNG (1-indexed, matching the storage
   * convention page-1.png…page-4.png). Returns 404 if the page hasn't been
   * rendered yet — the <img onError> in the frontend handles this gracefully.
   */
  async pdfPage({ params, response }: HttpContext) {
    const id = Number(params.id)
    const page = Number(params.page)
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(page) || page <= 0) {
      return response.notFound({ error: 'invalid id or page' })
    }

    const pagePath = join(
      StlScannerService.LIBRARY_ROOT,
      StlScannerService.THUMBNAIL_DIR,
      'pdf-pages',
      String(id),
      `page-${page}.png`
    )

    if (!existsSync(pagePath)) {
      return response.notFound({ error: 'page not found' })
    }

    response.header('Content-Type', 'image/png')
    response.header('Cache-Control', 'private, max-age=3600')
    return response.stream(createReadStream(pagePath))
  }

  /**
   * GET /api/workshop/files/:id/pdf-text
   *
   * Lazy endpoint for the PDF text extract disclosure widget. Returns the
   * stored pdf_text_extract string without putting 20 KB in the page prop.
   */
  async pdfText({ params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.notFound({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row) return response.notFound({ error: 'STL file not found' })

    return { text: row.pdf_text_extract ?? '' }
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
    if (payload.description !== undefined) row.description = payload.description
    if (payload.source_url !== undefined) row.source_url = payload.source_url
    if (payload.license !== undefined) row.license = payload.license

    // STL-only metadata — skip silently for non-STL types so a mis-submitted
    // payload can't corrupt fields that don't apply to the file's actual type.
    if (row.file_type === 'stl') {
      if (payload.material !== undefined) row.material = payload.material
      if (payload.print_time_minutes !== undefined)
        row.print_time_minutes = payload.print_time_minutes
      if (payload.infill_pct !== undefined) row.infill_pct = payload.infill_pct
      if (payload.difficulty !== undefined) row.difficulty = payload.difficulty
    }

    row.metadata_pending = !StlFile.isMetadataComplete({
      file_type: row.file_type,
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

    await this.deleteRowFiles(row)
    await row.delete()
    return { success: true }
  }

  /**
   * POST /api/workshop/batch — operate on many rows at once.
   *
   * Three actions share one endpoint (the UI's selection bar drives all three):
   *   • update-metadata — set material and/or difficulty on every selected row,
   *     then recompute each row's metadata_pending so a bulk fill exits the
   *     pending state just like the single-row update does.
   *   • recategorize — move every selected row to a category. Category is NOT
   *     part of the completeness check, so metadata_pending is left untouched.
   *   • delete — unlink each row's file (+ thumbnail) on disk, tolerate ENOENT,
   *     then delete the row. Reuses the same `deleteRowFiles` helper destroy()
   *     uses so the on-disk cleanup logic lives in exactly one place.
   *
   * Ungated like update()/destroy() — it's a metadata/DB surface, not an
   * upload. The action→required-field gate runs through the pure
   * `requiredFieldsPresent` helper (unit-tested) before any rows are touched.
   */
  async batch({ request, response }: HttpContext) {
    const payload = await request.validateUsing(batchWorkshopValidator)

    const gate = requiredFieldsPresent(payload.action, {
      material: payload.material,
      difficulty: payload.difficulty,
      category: payload.category,
    })
    if (!gate.ok) {
      return response.badRequest({ error: gate.error })
    }

    const rows = await StlFile.query().whereIn('id', payload.ids)

    let affected = 0

    if (payload.action === 'update-metadata') {
      for (const row of rows) {
        if (payload.material !== undefined) row.material = payload.material
        if (payload.difficulty !== undefined) row.difficulty = payload.difficulty
        row.metadata_pending = !StlFile.isMetadataComplete({
          file_type: row.file_type,
          name: row.name,
          material: row.material,
          print_time_minutes: row.print_time_minutes,
          difficulty: row.difficulty,
        })
        await row.save()
        affected++
      }
    } else if (payload.action === 'recategorize') {
      // `category` is guaranteed present by the gate above.
      const category = payload.category as StlCategory
      for (const row of rows) {
        row.category = category
        await row.save()
        affected++
      }
    } else {
      // delete
      for (const row of rows) {
        await this.deleteRowFiles(row)
        await row.delete()
        affected++
      }
    }

    return { success: true, action: payload.action, affected }
  }

  /**
   * POST /api/workshop/files/:id/thumbnail-upload — manual PNG thumbnail.
   *
   * The auto-generator (stl-thumb) can fail on a file it can't parse, which
   * sets thumbnail_failed=true and leaves the grid showing the generic SVG
   * fallback. This lets the user supply a PNG by hand. PNG only, because the
   * thumbnail-serve endpoint hardcodes Content-Type image/png.
   *
   * Gated by localNetworkOnly on the route (it writes a file, same as upload).
   */
  async uploadThumbnail({ params, request, response }: HttpContext) {
    if (!existsSync(StlScannerService.LIBRARY_ROOT)) {
      return response.serviceUnavailable({
        error: 'Data drive is not mounted — reconnect the drive and try again.',
      })
    }

    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const row = await StlFile.find(id)
    if (!row) return response.notFound({ error: 'STL file not found' })

    const file = request.file('thumbnail', { extnames: ['png'], size: '5mb' })
    if (!file) {
      return response.badRequest({ error: 'No thumbnail uploaded.' })
    }
    if (!file.isValid) {
      const reason =
        file.errors.length > 0
          ? file.errors.map((e) => e.message).join('; ')
          : 'File rejected by upload validator'
      return response.badRequest({ error: reason })
    }

    const thumbDir = join(StlScannerService.LIBRARY_ROOT, StlScannerService.THUMBNAIL_DIR)
    await fs.mkdir(thumbDir, { recursive: true })

    const thumbName = `${id}-manual.png`
    await file.move(thumbDir, { name: thumbName, overwrite: true })

    const thumbRelPath = join(StlScannerService.THUMBNAIL_DIR, thumbName)
    row.thumbnail_path = thumbRelPath
    row.thumbnail_failed = false
    await row.save()

    return { success: true, thumbnail_path: thumbRelPath }
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
    const mime = DOWNLOAD_MIME_MAP[ext] ?? 'application/octet-stream'
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
   * GET /api/workshop/upload-permitted — the Workshop page calls this on load
   * to decide whether to render the upload drop zone or a "LAN-only" note.
   * Returns the same shape the named middleware uses for its reject body so
   * the UI can show a consistent reason string.
   */
  async uploadPermitted({ request }: HttpContext) {
    const check = isLocalNetworkRequest(request)
    return {
      permitted: check.permitted,
      reason: check.reason,
      observed_ip: check.observed_ip,
    }
  }

  /**
   * POST /api/workshop/upload — accept one or more STL/3MF files via multipart
   * form-data and write them under `${LIBRARY_ROOT}/<category>/`. After all
   * moves complete, a scoped scan indexes just the uploaded files (upserts +
   * thumbnails) so they appear in the library without sweeping the whole tree.
   *
   * Network gating is handled by the `localNetworkOnly` named middleware
   * registered on the route — this method assumes the request has already
   * cleared that gate.
   *
   * Returns `{ uploaded: [...], rejected: [...], scan_result }` so the UI can
   * report per-file success/failure. A 503 means the data drive isn't mounted.
   */
  async upload({ request, response }: HttpContext) {
    if (!existsSync(StlScannerService.LIBRARY_ROOT)) {
      return response.serviceUnavailable({
        error: 'Data drive is not mounted — reconnect the drive and try again.',
      })
    }

    const rawCategory = String(request.input('category', 'other'))
    if (!(STL_CATEGORIES as readonly string[]).includes(rawCategory)) {
      return response.badRequest({
        error: `Invalid category. Must be one of: ${STL_CATEGORIES.join(', ')}`,
      })
    }
    const category = rawCategory as StlCategory

    const files = request.files('files', {
      extnames: ['stl', '3mf', 'step', 'stp', 'dxf', 'dwg', 'f3d', 'scad', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
      size: '200mb',
    })

    if (files.length === 0) {
      return response.badRequest({ error: 'No files uploaded.' })
    }

    const categoryDir = join(StlScannerService.LIBRARY_ROOT, category)
    await fs.mkdir(categoryDir, { recursive: true })

    const uploaded: { filename: string; path: string; size_bytes: number }[] = []
    const rejected: { filename: string; reason: string }[] = []
    const movedAbsPaths: string[] = []

    for (const file of files) {
      if (!file.isValid) {
        const reason =
          file.errors.length > 0
            ? file.errors.map((e) => e.message).join('; ')
            : 'File rejected by upload validator'
        rejected.push({ filename: file.clientName, reason })
        continue
      }

      const ext = (file.extname ?? '').toLowerCase()
      // Classify the extension — rejects anything not in the maker-library set.
      if (!classifyFileType(ext)) {
        rejected.push({
          filename: file.clientName,
          reason: `Unsupported file type (.${ext || 'unknown'}). Accepted: STL, 3MF, CAD (STEP/STP/DXF/DWG/F3D/SCAD), PDF, images (PNG/JPG/WEBP/GIF).`,
        })
        continue
      }

      // Use Adonis's verified extname (lowercased) and sanitize the basename.
      // Never trust the user-provided clientName for the on-disk filename.
      const rawBase = basename(file.clientName, extname(file.clientName)) || 'upload'
      const sanitizedBase = sanitizeFilename(rawBase)
      let targetName = `${sanitizedBase}.${ext}`
      let targetAbs = join(categoryDir, targetName)

      // Avoid clobbering an existing file — never silently overwrite.
      if (existsSync(targetAbs)) {
        const suffix = randomBytes(4).toString('hex')
        targetName = `${sanitizedBase}-${suffix}.${ext}`
        targetAbs = join(categoryDir, targetName)
      }

      try {
        await file.move(categoryDir, { name: targetName, overwrite: false })
        uploaded.push({
          filename: targetName,
          path: join(category, targetName),
          size_bytes: file.size,
        })
        movedAbsPaths.push(targetAbs)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn(`[WorkshopController] move failed for ${file.clientName}: ${msg}`)
        rejected.push({
          filename: file.clientName,
          reason: `Could not save file (drive may have disconnected): ${msg}`,
        })
      }
    }

    let scanResult = null
    if (movedAbsPaths.length > 0) {
      try {
        const scanner = new StlScannerService()
        scanResult = await scanner.scanPaths(movedAbsPaths)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn(`[WorkshopController] scanPaths failed: ${msg}`)
      }
    }

    // JSON contract uses snake_case (matches the existing /api/workshop/scan
    // shape) so the React UI can read scan_result.added/updated consistently.
    return { uploaded, rejected, scan_result: scanResult }
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

  /**
   * Best-effort unlink of a row's file on disk plus its thumbnail. Tolerates
   * already-missing files (ENOENT) — the drive may be disconnected, or a prior
   * scan already pruned the thumbnail. Shared by destroy() and the batch-delete
   * action so the on-disk cleanup contract lives in exactly one place.
   */
  private async deleteRowFiles(row: StlFile): Promise<void> {
    const fileAbs = join(StlScannerService.LIBRARY_ROOT, row.path)
    await fs.unlink(fileAbs).catch((err) => {
      if (err.code !== 'ENOENT') {
        logger.warn(`[WorkshopController] couldn't delete ${fileAbs}: ${err.message}`)
      }
    })
    if (row.thumbnail_path) {
      const thumbAbs = join(StlScannerService.LIBRARY_ROOT, row.thumbnail_path)
      await fs.unlink(thumbAbs).catch(() => {})
    }
    // Best-effort cleanup of the pdf-pages preview directory for this row.
    // The directory only exists for PDF rows, but rm with force:true on a
    // non-existent path is a no-op, so this is safe for all file types.
    const pdfPagesDir = join(
      StlScannerService.LIBRARY_ROOT,
      StlScannerService.THUMBNAIL_DIR,
      'pdf-pages',
      String(row.id)
    )
    await fs.rm(pdfPagesDir, { recursive: true, force: true }).catch(() => {})
  }

  private async rightsAcknowledged(): Promise<boolean> {
    const row = await KVStore.findBy('key', 'workshop.rightsAcknowledged')
    return row?.value === 'true'
  }

  private enumsForUi() {
    return {
      file_types: [...WORKSHOP_FILE_TYPES],
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
