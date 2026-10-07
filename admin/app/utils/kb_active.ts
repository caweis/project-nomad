/**
 * The knowledge base's per-file switch for whether search may use a file
 * (upstream f1624228, #1286).
 *
 * Switching a file off deletes nothing. Every Qdrant point carries an `active`
 * payload field, the switch flips it in place in either direction, and search
 * leaves out the points marked false. The kb_ingest_state row mirrors it so the
 * panel can show it without asking Qdrant.
 *
 * Pure and import-free, so the standalone checks can load it.
 */

/**
 * The Qdrant filter every search uses: leave out what was switched off, and
 * optionally keep to one collection.
 *
 * A denylist (must_not active == false) rather than an allowlist (must active
 * == true), so a point written before the field existed, and not yet reached
 * by the backfill, is still found. Search never depends on the backfill.
 */
export function searchFilter(collection?: string) {
  return {
    must_not: [{ key: 'active', match: { value: false } }],
    ...(collection ? { must: [{ key: 'collection', match: { value: collection } }] } : {}),
  }
}

/**
 * A row's `active` value as a real boolean. MySQL returns tinyint(1) as 1 or 0,
 * and upstream found a raw 1 reaching the page as aria-checked="1", which tells
 * a screen reader nothing. No row, or no value, means on: files start in search.
 */
export function effectiveActive(value: unknown): boolean {
  if (value === null || value === undefined) return true
  return Boolean(value)
}

/**
 * Change the rows, then the points, and put the rows back if the points cannot
 * be changed.
 *
 * Rows go first on purpose: embedAndStoreText reads the row again after it
 * writes a batch, so a file switched while it is being indexed converges on the
 * row whichever write lands first. That ordering leaves one bad outcome, which
 * is Qdrant failing after the rows have changed. The panel would then show a
 * setting that search is not using, and it reads the row, not Qdrant (upstream
 * c65198c7). Putting the rows back keeps the panel telling the truth.
 *
 * The caller's error is what gets thrown. A failure to put the rows back is
 * reported through `onRestoreFailed` and never replaces it: "the switch did not
 * work" is the news, and the second failure is a detail of it.
 */
export async function writeRowsThenPoints(steps: {
  writeRows: () => Promise<unknown>
  writePoints: () => Promise<unknown>
  restoreRows: () => Promise<unknown>
  onRestoreFailed: (error: unknown) => void
}): Promise<void> {
  await steps.writeRows()
  try {
    await steps.writePoints()
  } catch (error) {
    try {
      await steps.restoreRows()
    } catch (restoreError) {
      steps.onRestoreFailed(restoreError)
    }
    throw error
  }
}

export type ToggleInput<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Read a request to switch one file. `active` must be a real JSON boolean. That
 * is more than tidiness: an HTML form on another site can only send strings, so
 * refusing "true" is what keeps this write out of reach of a cross-site form
 * post (upstream f1624228). Do not coerce it.
 */
export function parseFileActiveInput(
  source: unknown,
  active: unknown
): ToggleInput<{ source: string; active: boolean }> {
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, error: 'source is required.' }
  }
  if (typeof active !== 'boolean') {
    return { ok: false, error: 'active must be true or false.' }
  }
  return { ok: true, value: { source, active } }
}

/**
 * Read a request to switch every file in a collection, with the same rule for
 * `active`. The collection is checked for type before anything trims it: a
 * form-encoded `collection[]=a` arrives as an array (upstream f1624228).
 *
 * A named collection only. Upstream also takes null, for Uncategorized, but on
 * the server that reaches every point without a collection, which is every ZIM
 * and NOMAD's own help pages, while its screen shows only uploads under that
 * heading. Switching Uncategorized off there leaves the whole library out of
 * search.
 */
export function parseCollectionActiveInput(
  collection: unknown,
  active: unknown
): ToggleInput<{ collection: string; active: boolean }> {
  if (typeof collection !== 'string' || collection.trim() === '') {
    return { ok: false, error: 'collection must be a collection name.' }
  }
  if (typeof active !== 'boolean') {
    return { ok: false, error: 'active must be true or false.' }
  }
  return { ok: true, value: { collection, active } }
}

/** What to tell the user after switching one file. */
export function fileActiveMessage(fileName: string, active: boolean): string {
  return active
    ? `"${fileName}" will be used in answers.`
    : `"${fileName}" won't be used in answers. Nothing was deleted; switch it back on at any time.`
}

/**
 * What to tell the user after switching a whole collection. `changed` counts the
 * files that actually changed, so switching off twelve files of which three were
 * already off reports nine (upstream f1624228).
 */
export function collectionActiveMessage(
  collection: string,
  active: boolean,
  changed: number
): string {
  if (changed === 0) {
    return `Every file in "${collection}" was already switched ${active ? 'on' : 'off'}.`
  }
  const files = `${changed} file${changed === 1 ? '' : 's'}`
  return active
    ? `${files} in "${collection}" will be used in answers.`
    : `${files} in "${collection}" won't be used in answers.`
}
