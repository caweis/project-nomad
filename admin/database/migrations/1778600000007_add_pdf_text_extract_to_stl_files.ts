import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Workshop CAD/PDF previews v1 (#7) — PDF text extraction column.
 *
 * Adds `pdf_text_extract TEXT NULL` to `stl_files`. Populated at scan time
 * by StlScannerService using pdf-parse (first 5 pages, capped at 20 KB) for
 * rows with file_type='pdf'. NULL for non-PDF rows and for PDFs where
 * extraction failed or hasn't run yet.
 *
 * No index needed for v1 — the operator's personal library is small enough
 * that a LIKE search over this column is sufficient. A FULLTEXT index is
 * tracked as a v2 enhancement.
 */
export default class extends BaseSchema {
  protected tableName = 'stl_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('pdf_text_extract').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('pdf_text_extract')
    })
  }
}
