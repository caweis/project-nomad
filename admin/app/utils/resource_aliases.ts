import type { ZimCategoriesSpec } from '../../types/collections.js'

/** Only an unambiguous retired ID can identify a different book in the catalog. */
export function buildPreviousIdMap(
  spec: ZimCategoriesSpec | null | undefined
): Map<string, string> {
  const aliases = new Map<string, string>()
  const excluded = new Set<string>()
  for (const category of spec?.categories ?? []) {
    for (const tier of category.tiers) {
      for (const resource of tier.resources) {
        excluded.add(resource.id)
        for (const formerId of resource.previous_ids ?? []) {
          if (!formerId) continue
          const owner = aliases.get(formerId)
          if (owner && owner !== resource.id) excluded.add(formerId)
          aliases.set(formerId, resource.id)
        }
      }
    }
  }
  for (const id of excluded) aliases.delete(id)
  return aliases
}

type ZimEdition = { name: string; version: string }

/** Choose one file consistently when old and new names for a book coexist. */
export function preferZimEdition(
  currentId: string,
  candidate: ZimEdition,
  existing: ZimEdition
): boolean {
  if (candidate.version !== existing.version) return candidate.version > existing.version
  const currentName = currentId + '_' + candidate.version + '.zim'
  if (candidate.name === currentName) return true
  return existing.name !== currentName && candidate.name < existing.name
}
