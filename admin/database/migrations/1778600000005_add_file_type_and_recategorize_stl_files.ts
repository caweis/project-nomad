import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Workshop-broaden v1 (#6) — extend stl_files for the general maker library.
 *
 * up():
 *   1. Add `file_type` varchar(16) NOT NULL DEFAULT 'stl' — all existing rows
 *      are STL/3MF so the default backfills them correctly without touching any
 *      row's explicit data.
 *   2. Add idx_stl_files_file_type index — drives the new file-type filter.
 *   3. Remap two category values that changed names in the 7 → 14 expansion:
 *        'tools'       → 'tools-hardware'
 *        'agriculture' → 'agriculture-homestead'
 *      The other 5 old values (medical, replacement-parts, household,
 *      firearm-accessories, other) are valid in the new 14-set and need no
 *      change. Both UPDATEs are idempotent — re-running the migration (e.g.
 *      on a restored DB) won't corrupt data that has already been remapped.
 *
 * down():
 *   Drops the index and the column. Category remap is NOT reversed — this is
 *   forward-only data normalisation and rolling it back would be destructive.
 *   That's acceptable: the whole migration is about naming, and the old values
 *   would no longer exist in the codebase's category enum anyway.
 */
export default class extends BaseSchema {
  protected tableName = 'stl_files'

  async up() {
    // 1. Add file_type column with stl default.
    this.schema.alterTable(this.tableName, (table) => {
      table.string('file_type', 16).notNullable().defaultTo('stl')
    })

    // 2. Add file_type index.
    this.schema.alterTable(this.tableName, (table) => {
      table.index('file_type', 'idx_stl_files_file_type')
    })

    // 3. Remap categories — idempotent WHERE guards ensure safety on re-run.
    await this.db.rawQuery(
      `UPDATE ${this.tableName} SET category = 'tools-hardware' WHERE category = 'tools'`
    )
    await this.db.rawQuery(
      `UPDATE ${this.tableName} SET category = 'agriculture-homestead' WHERE category = 'agriculture'`
    )
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex('file_type', 'idx_stl_files_file_type')
      table.dropColumn('file_type')
    })
    // Category remap is not reversed (forward-only normalisation).
  }
}
