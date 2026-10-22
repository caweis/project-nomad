/** Pure helpers for the post-rerank relevance floor. */
export function parseMinRelevance(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined) return fallback
  const value = raw.trim().toLowerCase()
  if (value === '' || value === 'auto') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

/** Filter before source diversity, which measures redundancy rather than relevance. */
export function applyRelevanceFloor<T extends { finalScore: number }>(
  results: T[],
  minFinalScore: number
): { survivors: T[]; belowFloor: number } {
  if (minFinalScore <= 0) return { survivors: results, belowFloor: 0 }
  const survivors = results.filter((result) => result.finalScore >= minFinalScore)
  return { survivors, belowFloor: results.length - survivors.length }
}
