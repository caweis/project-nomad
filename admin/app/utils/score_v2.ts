/** Frozen against Crosstalk's Score v2 server formula for benchmark_version 2.0.0. */
export const SCORE_V2_REFERENCE = {
  ai_tokens_per_second: 13.2,
  cpu_events_multi: 19231,
  cpu_events_single: 2351,
  memory_ops_per_sec: 26862960,
  disk_read_mb_per_sec: 1072,
  disk_write_mb_per_sec: 316,
} as const

export const SCORE_V2_WEIGHTS = {
  ai_tokens_per_second: 0.3,
  cpu_events_multi: 0.25,
  cpu_events_single: 0.1,
  memory_ops_per_sec: 0.1,
  disk_read_mb_per_sec: 0.125,
  disk_write_mb_per_sec: 0.125,
} as const

export type ScoreV2Raws = Record<keyof typeof SCORE_V2_REFERENCE, number>
const CHANNELS = Object.keys(SCORE_V2_REFERENCE) as (keyof ScoreV2Raws)[]
if (Math.abs(CHANNELS.reduce((sum, channel) => sum + SCORE_V2_WEIGHTS[channel], 0) - 1) > 1e-9) {
  throw new Error('Score v2 weights must sum to one')
}

export function calculateNomadScoreV2(raws: ScoreV2Raws): number {
  let logSum = 0
  for (const channel of CHANNELS) {
    const raw = raws[channel]
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new Error(`Score v2 channel ${channel} must be finite and positive`)
    }
    logSum += SCORE_V2_WEIGHTS[channel] * Math.log2(raw / SCORE_V2_REFERENCE[channel])
  }
  const score = 1000 * Math.pow(2, logSum)
  if (!Number.isFinite(score)) throw new Error('Score v2 result is not finite')
  return Math.round(score * 10) / 10
}
