import type { NomadOllamaModel } from '../types/ollama.js'

/**
 * MLX availability resolution for the oMLX backend.
 *
 * In oMLX mode the admin's model catalog is the full, general Ollama library,
 * but the oMLX proxy can only pull the curated set of mlx-community conversions
 * listed in model_map.json (exposed as GET /api/nomad/pullable). These helpers
 * map a catalog model to the exact pullable key the proxy resolves — the single
 * source of "is this model available as MLX, and if so, under what name" — so
 * the UI can disable models with no MLX build and send a name that always
 * resolves (the symmetry contract enforced in nomad_pull.py).
 *
 * Pure + dependency-free so it is unit-testable without booting AdonisJS.
 */

/**
 * Parse the parameter size (in billions) from a model_map key's tag portion.
 * e.g. "gemma3:12b" -> 12, "qwen2.5-coder:7b" -> 7, "qwen2.5:1.5b" -> 1.5.
 * Returns +Infinity when there is no numeric size token (e.g. the embedding
 * keys "nomic-embed-text" / "mxbai-embed-large", which have no ':' tag) so such
 * keys never win the "smallest" comparison for a chat family.
 */
export function parsePullableSizeB(key: string): number {
  const tag = key.split(':')[1]
  if (!tag) return Number.POSITIVE_INFINITY
  const match = tag.match(/(\d+\.?\d*)\s*b/i)
  return match ? Number.parseFloat(match[1]) : Number.POSITIVE_INFINITY
}

/**
 * Given a catalog model's family (its base name, e.g. "llama3.1") and the
 * proxy's pullable model_map keys, return the smallest pullable key whose
 * family matches — or undefined when the family has no MLX conversion.
 *
 * "Family" is the entire substring before the first ':' and must match exactly
 * (so "llama3" does NOT match "llama3.1:8b"). "Smallest" is chosen so a model
 * whose only MLX builds are large (e.g. deepseek-r1, mapped at 32b/70b while
 * the catalog shows a 1.5b tag) still resolves to a real, pullable name rather
 * than being marked unavailable.
 */
export function resolveMlxPullName(family: string, pullableKeys: string[]): string | undefined {
  let best: string | undefined
  let bestSize = Number.POSITIVE_INFINITY
  for (const key of pullableKeys) {
    if (key.split(':')[0] !== family) continue
    const size = parsePullableSizeB(key)
    if (best === undefined || size < bestSize) {
      best = key
      bestSize = size
    }
  }
  return best
}

/**
 * Return a copy of *models* with `mlxPullName` set on each model that has a
 * matching MLX conversion. Immutable: never mutates the inputs, so passing the
 * shared FALLBACK_RECOMMENDED_OLLAMA_MODELS const through is safe.
 */
export function withMlxPullNames(
  models: NomadOllamaModel[],
  pullableKeys: string[]
): NomadOllamaModel[] {
  return models.map((model) => {
    const pull = resolveMlxPullName(model.name, pullableKeys)
    return pull ? { ...model, mlxPullName: pull } : model
  })
}
