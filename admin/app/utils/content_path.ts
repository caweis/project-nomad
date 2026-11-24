import { basename, relative, resolve, sep } from 'node:path'

/** Content checks recognize year, month and day precision. The extension and complete ID must match. */
export function parseDatedContentFilename(filename: string, type: 'zim' | 'map') {
  const match = /^([^/\\]+)_(\d{4}(?:-\d{2}(?:-\d{2})?)?)\.(zim|pmtiles)$/.exec(filename)
  if (!match || match[3] !== (type === 'zim' ? 'zim' : 'pmtiles')) return null
  return { resource_id: match[1], version: match[2] }
}

/** Limit cleanup to a dated file of this exact resource directly inside its storage folder. */
export function isSafeOldContentPath(
  oldFilePath: string,
  resourceId: string,
  storageRoot: string,
  resourceType: 'zim' | 'map',
  aliases?: ReadonlyMap<string, string>,
  replacementVersion?: string
): boolean {
  if (!resourceId || oldFilePath.split(sep).includes('..')) return false
  const leaf = relative(resolve(storageRoot), resolve(oldFilePath))
  if (leaf !== basename(leaf)) return false
  const parsed = parseDatedContentFilename(leaf, resourceType)
  if (!parsed || (replacementVersion && parsed.version > replacementVersion)) return false
  return (
    parsed.resource_id === resourceId ||
    (resourceType === 'zim' && aliases?.get(parsed.resource_id) === resourceId)
  )
}
