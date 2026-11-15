import type { NomadOllamaModel } from '../../types/ollama.js'

export function parseModelPulls(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i)
  if (!match) return null
  const suffix = match[2]?.toUpperCase()
  const multiplier =
    suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1
  const count = Number(match[1]) * multiplier
  return Number.isFinite(count) ? count : null
}

export function compareModelsByPopularity(a: NomadOllamaModel, b: NomadOllamaModel): number {
  const aPulls = parseModelPulls(a.estimated_pulls)
  const bPulls = parseModelPulls(b.estimated_pulls)
  if (aPulls === null && bPulls !== null) return 1
  if (bPulls === null && aPulls !== null) return -1
  return (bPulls ?? 0) - (aPulls ?? 0) || a.name.localeCompare(b.name)
}
