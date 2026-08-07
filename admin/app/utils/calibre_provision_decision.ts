export type CalibreProvisionStep = 'seed-library-db' | 'materialize-app-db' | 'point-library'

export interface CalibreProvisionState {
  /** <storage>/calibre-web/books/metadata.db exists */
  libraryDbExists: boolean
  /** <storage>/calibre-web/app.db exists */
  appDbExists: boolean
  /**
   * config_calibre_dir from app.db's single settings row. null when app.db,
   * the settings table, or the row is absent — or when the column is NULL/''.
   */
  configCalibreDir: string | null
}

/**
 * Decide what the Calibre-Web provisioner must do, given what is on disk.
 *
 * Facts this encodes (verified against calibre-web 0.6.26 source):
 * - The first-run wizard fires until config_calibre_dir names a directory that
 *   contains a metadata.db file — those two things are the entire contract.
 * - calibre-web seeds its admin and the load-bearing Guest user rows ONLY when
 *   it creates app.db itself, so app.db must be materialized by the app's own
 *   init (`cps.py -d`), never hand-written.
 * - A settings row whose config_calibre_dir is set means a person (or a prior
 *   provision) configured this install. HANDS OFF — reconfiguring a working
 *   library out from under the user is worse than any wizard.
 */
export function decideProvisionSteps(state: CalibreProvisionState): CalibreProvisionStep[] {
  if (state.configCalibreDir) return []

  const steps: CalibreProvisionStep[] = []
  if (!state.libraryDbExists) steps.push('seed-library-db')
  if (!state.appDbExists) steps.push('materialize-app-db')
  steps.push('point-library')
  return steps
}
