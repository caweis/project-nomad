/**
 * Workshop batch-operation — pure required-field gate.
 *
 * The batch endpoint (POST /api/workshop/batch) performs one of three actions
 * over a set of file ids. Each action has a different "what must be present in
 * the payload" contract:
 *   • update-metadata → at least ONE of {material, difficulty}
 *   • recategorize    → category
 *   • delete          → nothing (the ids are enough)
 *
 * Declared here as a pure function (no DB / Adonis imports) so the controller
 * can call it AND a unit test can exercise every branch without booting the
 * Japa suite, mirroring the embed_jobs.ts helper pattern.
 */

export type WorkshopBatchAction = 'update-metadata' | 'recategorize' | 'delete'

/**
 * Only the fields the gate inspects. The controller passes the validated
 * payload; values may be `null` (an explicit "clear this field" for metadata)
 * or `undefined` (not supplied). A `null` material/difficulty still counts as
 * "supplied" for update-metadata — the caller is choosing to clear it.
 */
export interface WorkshopBatchFields {
  material?: string | null
  difficulty?: string | null
  category?: string
}

export interface RequiredFieldsResult {
  ok: boolean
  error?: string
}

/**
 * Validate that the payload carries the fields the chosen action requires.
 * Returns `{ ok: true }` when satisfied, otherwise `{ ok: false, error }` with
 * a message suitable for a 400 response body.
 */
export function requiredFieldsPresent(
  action: WorkshopBatchAction,
  fields: WorkshopBatchFields
): RequiredFieldsResult {
  switch (action) {
    case 'update-metadata': {
      const hasMaterial = fields.material !== undefined
      const hasDifficulty = fields.difficulty !== undefined
      if (!hasMaterial && !hasDifficulty) {
        return {
          ok: false,
          error: 'update-metadata requires at least one of: material, difficulty',
        }
      }
      return { ok: true }
    }
    case 'recategorize': {
      if (fields.category === undefined) {
        return { ok: false, error: 'recategorize requires a category' }
      }
      return { ok: true }
    }
    case 'delete':
      return { ok: true }
    default: {
      // Exhaustiveness guard — an unknown action is never valid.
      return { ok: false, error: `unknown action: ${String(action)}` }
    }
  }
}
