/**
 * Which file's knowledge to forget after a content download finishes.
 *
 * A content update replaces a ZIM with a newer edition at a different path (the
 * version is in the file name) and deletes the old file. What the knowledge base
 * learned from the old file stays behind unless something removes it: its
 * passages are still retrieved beside the new edition's, and the orphan sweep is
 * left to clear them later. A sweep refuses to clear most of a folder at once
 * (see ORPHAN_PURGE_MAX_FRACTION), so an update that replaces many files at once
 * would leave stale sources that the sweep then withholds for good.
 *
 * The answer is the old file's path only when it was a ZIM, it differs from the
 * new path, and it was actually deleted. A file that is still on disk keeps its
 * passages: they are still true of it.
 *
 * Pure and import-free.
 */
export function replacedFileToForget(input: {
  filetype: string
  oldFilePath: string | null
  newFilePath: string
  oldFileDeleted: boolean
}): string | null {
  if (input.filetype !== 'zim') return null
  if (!input.oldFilePath || input.oldFilePath === input.newFilePath) return null
  return input.oldFileDeleted ? input.oldFilePath : null
}
