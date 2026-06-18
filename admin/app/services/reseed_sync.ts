/**
 * Pure decision helper for the service seeder's reseed-sync behaviour.
 *
 * The seeder re-syncs curated catalog rows on every run so a catalog change (a new
 * port/scheme/config for a bundled app) reaches existing non-modified installs on
 * upgrade. Two classes of row must survive a reseed untouched:
 *   - custom apps      (is_custom)        — user-defined "bring your own" containers.
 *   - user-modified    (is_user_modified) — a curated app the user edited (e.g. changed a port).
 *
 * LIVES IN app/services (NOT database/seeders): `node ace db:seed` loads every file
 * under database/seeders as a Seeder and requires a default export, so a plain helper
 * placed there crashes the whole seed run ("Missing default export"). Kept Adonis-free
 * so the seeder and its standalone test single-source the decision and it runs under
 * `node --experimental-strip-types` (the seeder itself pulls in #start/env, which can't
 * boot without the Adonis runtime).
 */

/** The two flags the reseed decision reads off an existing row. */
export interface ReseedRowFlags {
  is_custom: boolean
  is_user_modified: boolean
}

/**
 * True when an existing curated row should be re-synced from the catalog.
 * False (skip) for custom apps and user-modified curated apps, so their edits survive.
 */
export function shouldReseedCuratedRow(existing: ReseedRowFlags | undefined): boolean {
  return existing !== undefined && !existing.is_custom && !existing.is_user_modified
}
