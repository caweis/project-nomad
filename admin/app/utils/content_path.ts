import { basename, relative, resolve } from 'node:path'

/** Limit replacement cleanup to this resource's prior file in its storage folder. */
export function isSafeOldContentPath(
  oldFilePath: string,
  resourceId: string,
  storageRoot: string
): boolean {
  if (!resourceId) return false
  const relativePath = relative(resolve(storageRoot), resolve(oldFilePath))
  return relativePath === basename(relativePath) && relativePath.startsWith(`${resourceId}_`)
}
