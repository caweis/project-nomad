import { resolve, sep } from 'node:path'

/**
 * Decides whether a curated resource's PREVIOUSLY-installed file should be
 * deleted now that a newer version has been downloaded (#858 — old map and ZIM
 * versions accumulated on disk indefinitely because only Wikipedia had version
 * cleanup, so every other update orphaned hundreds of GB).
 *
 * Pure, so every safety rail is unit-testable without a DB or a filesystem.
 * Five conjunctive rails, any of which keeps the old file:
 *   - tracked-only: a prior InstalledResource row must exist
 *   - genuine-replacement: the old path must differ from the new path
 *   - new-file-verified: the new file must be confirmed on disk
 *   - strictly-newer: a re-install or downgrade can't wipe a newer file
 *   - within-storage-dir: the resolved old path must live under the storage base
 *     (blocks a malformed DB row from directing a delete outside the content store)
 *
 * Ported from upstream bbd62d8 (#858).
 */
export interface SupersededInputs {
  existing: { file_path: string; version: string } | null
  newFilePath: string
  newVersion: string
  newFileExists: boolean
  storageBaseDir: string
}

export type SupersededReason =
  | 'first_install'
  | 'same_file'
  | 'new_file_missing'
  | 'not_newer'
  | 'outside_storage'
  | 'superseded'

export interface SupersededDecision {
  delete: boolean
  path?: string
  reason: SupersededReason
}

export function decideSupersededDeletion(inputs: SupersededInputs): SupersededDecision {
  const { existing, newFilePath, newVersion, newFileExists, storageBaseDir } = inputs

  if (!existing) return { delete: false, reason: 'first_install' }
  if (existing.file_path === newFilePath) return { delete: false, reason: 'same_file' }
  if (!newFileExists) return { delete: false, reason: 'new_file_missing' }
  // Lexical compare is correct for zero-padded YYYY-MM / YYYY-MM-DD versions,
  // which is what parseMapFilename / parseZimFilename produce for curated content.
  if (!(newVersion > existing.version)) return { delete: false, reason: 'not_newer' }

  const resolvedOld = resolve(existing.file_path)
  const base = resolve(storageBaseDir)
  if (resolvedOld !== base && !resolvedOld.startsWith(base + sep)) {
    return { delete: false, reason: 'outside_storage' }
  }

  return { delete: true, path: resolvedOld, reason: 'superseded' }
}
