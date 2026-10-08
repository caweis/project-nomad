import { randomUUID } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Clearing out upload files that nothing deleted.
 *
 * The upload parser writes each file it receives into the temp folder before any
 * controller runs. When a request fails inside the parser, because the person
 * closed the tab or the connection dropped part-way, the controller never runs,
 * and neither does its cleanup. Files the parser had already finished stay
 * behind: for a chat with pictures, the untouched originals with their camera
 * and location details; for a Workshop upload, up to 200 MB each. The container's
 * temp folder survives a restart, so they would stay until it is recreated.
 *
 * config/bodyparser.ts gives every such file a recognisable name, so abandoned
 * ones can be told from anything else in the folder. This removes the ones
 * nothing has written to for a long time.
 *
 * Only node builtins are imported, so the standalone checks can load it.
 */

/** Every temporary file the upload parser writes starts with this. */
export const UPLOAD_TMP_PREFIX = 'nomad-upload-'

/** The name config/bodyparser.ts gives each temporary upload file. */
export const uploadTmpFileName = () => `${UPLOAD_TMP_PREFIX}${randomUUID()}`

/**
 * How long an upload's file must sit untouched before it counts as abandoned. A
 * finished request removes its own file, and an upload in progress is being
 * written to all the time, so six hours is far past either.
 */
export const STALE_UPLOAD_MAX_AGE_MS = 6 * 60 * 60 * 1000

export function isStaleUpload(
  name: string,
  modifiedMs: number,
  nowMs: number,
  maxAgeMs: number = STALE_UPLOAD_MAX_AGE_MS
): boolean {
  return name.startsWith(UPLOAD_TMP_PREFIX) && nowMs - modifiedMs >= maxAgeMs
}

/**
 * Remove the abandoned upload files in `dir`. Returns how many were removed.
 * Never throws: a file that cannot be read or removed is left for the next pass,
 * and so is a folder that cannot be listed.
 */
export async function sweepStaleUploads(
  dir: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = STALE_UPLOAD_MAX_AGE_MS
): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }

  let removed = 0
  for (const name of names) {
    if (!name.startsWith(UPLOAD_TMP_PREFIX)) continue
    try {
      const path = join(dir, name)
      const info = await stat(path)
      if (info.isFile() && isStaleUpload(name, info.mtimeMs, nowMs, maxAgeMs)) {
        await rm(path, { force: true })
        removed += 1
      }
    } catch {
      // Gone already, or not ours to touch: leave it.
    }
  }
  return removed
}
