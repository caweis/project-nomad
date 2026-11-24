import { BaseSchema } from '@adonisjs/lucid/schema'
import vine from '@vinejs/vine'
import { wikipediaSpecSchema } from '../../app/validators/curated_collections.js'
import { filenameFromDownloadUrl } from '../../app/utils/download_filename.js'
import { zimFilenameStem } from '../../app/utils/zim_filename.js'

const monthlyEdition = /_\d{4}-(?:0[1-9]|1[0-2])\.zim$/
const previewOptions = new Set(['top-mini', 'top-nopic', 'all-mini', 'all-nopic', 'all-maxi'])

function hasMonthlyEdition(filename: string, stem: string): boolean {
  return monthlyEdition.test(filename) && zimFilenameStem(filename) === stem
}

async function hasOnlyPreviewOptions(raw: unknown): Promise<boolean> {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    const spec = await vine.validate({ schema: wikipediaSpecSchema, data })
    if (new Set(spec.options.map((option) => option.id)).size !== spec.options.length) return false
    return spec.options.every(({ id, url }) => {
      if (id === 'none') return url === null
      if (!previewOptions.has(id) || !url || !/^https?:\/\//i.test(url)) return false
      const filename = filenameFromDownloadUrl(url)
      return !!filename && hasMonthlyEdition(filename, `wikipedia_en_${id.replace('-', '_')}`)
    })
  } catch {
    // A malformed or unfamiliar cache cannot establish what the user selected.
    return false
  }
}

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      // The mirror preview assigned "unknown" to unrelated completed downloads.
      // Its fix reached Mac main together with the feature, but preview installs may carry this row.
      const rows = await db
        .from('wikipedia_selections')
        .where({
          option_id: 'unknown',
          status: 'installed',
        })
        .select('id', 'option_id', 'status', 'filename', 'url')
        .forUpdate()
      const captured = rows.filter(
        (row) =>
          row.option_id === 'unknown' &&
          row.status === 'installed' &&
          typeof row.filename === 'string' &&
          hasMonthlyEdition(row.filename, 'wikipedia_en_medicine_maxi') &&
          typeof row.url === 'string' &&
          /^https?:\/\//i.test(row.url) &&
          filenameFromDownloadUrl(row.url) === row.filename
      )
      if (captured.length === 0) return

      const manifest = await db
        .from('collection_manifests')
        .where('type', 'wikipedia')
        .select('spec_data')
        .forUpdate()
        .first()
      if (manifest && !(await hasOnlyPreviewOptions(manifest.spec_data))) return

      for (const row of captured) {
        await db.from('wikipedia_selections').where('id', row.id).update({
          option_id: 'none',
          status: 'none',
          filename: null,
          url: null,
        })
      }
    })
  }

  async down() {
    // The previous selection is unknown. Keep the tier file available to reconciliation.
  }
}
