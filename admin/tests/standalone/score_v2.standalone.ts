import assert from 'node:assert/strict'
import { calculateNomadScoreV2, SCORE_V2_REFERENCE } from '../../app/utils/score_v2.ts'

assert.equal(calculateNomadScoreV2(SCORE_V2_REFERENCE), 1000)
assert.equal(
  calculateNomadScoreV2({
    ...SCORE_V2_REFERENCE,
    cpu_events_multi: SCORE_V2_REFERENCE.cpu_events_multi * 4,
  }),
  1414.2
)
assert.equal(
  calculateNomadScoreV2({
    ...SCORE_V2_REFERENCE,
    disk_read_mb_per_sec: SCORE_V2_REFERENCE.disk_read_mb_per_sec / 2,
  }),
  917
)
for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => calculateNomadScoreV2({ ...SCORE_V2_REFERENCE, cpu_events_single: bad }))
}
console.log('score_v2: 7 passed')
