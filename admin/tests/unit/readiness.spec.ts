import { test } from '@japa/runner'
import {
  computeResourceReadiness,
  YELLOW_BAND,
  type ReadinessResource,
} from '../../util/readiness.js'

const WATER_PER_PERSON = 3.785411784 // 1 US gal/person/day in liters (base unit)
const FOOD_PER_PERSON = 2000 // kcal/person/day (base unit)

/** Helper: water readiness with N people, no pets, default per-person need. */
function water(haveBase: number, people: number, target = 14, petIntake = 0) {
  return computeResourceReadiness('water', haveBase, people, WATER_PER_PERSON, petIntake, target)
}

test.group('readiness · dailyNeed (no multipliers — children are full persons)', () => {
  test('children count as full persons for water (FEMA/Ready.gov: never discount)', ({
    assert,
  }) => {
    // 2 adults + 2 children = 4 full persons, NO 0.5 child fraction.
    const r = water(0, 4)
    assert.closeTo(r.dailyNeed, 4 * WATER_PER_PERSON, 1e-9)
  })

  test('food daily need is people * 2000 kcal with no discount', ({ assert }) => {
    const r = computeResourceReadiness('food', 0, 3, FOOD_PER_PERSON, 0, 14)
    assert.closeTo(r.dailyNeed, 3 * FOOD_PER_PERSON, 1e-9)
  })

  test('pets add their user-entered intake to water (water/food only)', ({ assert }) => {
    // 2 people + 10 L/day of pet water.
    const r = water(0, 2, 14, 10)
    assert.closeTo(r.dailyNeed, 2 * WATER_PER_PERSON + 10, 1e-9)
  })

  test('pets add their user-entered intake to food', ({ assert }) => {
    const r = computeResourceReadiness('food', 0, 2, FOOD_PER_PERSON, 500, 14)
    assert.closeTo(r.dailyNeed, 2 * FOOD_PER_PERSON + 500, 1e-9)
  })

  test('power IGNORES any pet intake (no pet power term per §5.1.1)', ({ assert }) => {
    // Even if a caller passes a pet intake, power must not include it.
    const r = computeResourceReadiness('power', 0, 2, 1000, 999, 14)
    assert.equal(r.dailyNeed, 2 * 1000)
  })
})

test.group('readiness · status thresholds (green / yellow / red at boundaries)', () => {
  test('days exactly == target → green (inclusive)', ({ assert }) => {
    // have = target * dailyNeed → days == target exactly.
    const target = 14
    const have = target * 2 * WATER_PER_PERSON
    const r = water(have, 2, target)
    assert.closeTo(r.days ?? -1, target, 1e-9)
    assert.equal(r.status, 'green')
    assert.equal(r.gapBase, 0)
  })

  test('days just above target → green', ({ assert }) => {
    const target = 14
    const have = (target + 0.5) * 2 * WATER_PER_PERSON
    const r = water(have, 2, target)
    assert.equal(r.status, 'green')
  })

  test('days exactly == target * YELLOW_BAND → yellow (inclusive lower bound)', ({ assert }) => {
    const target = 14
    const have = target * YELLOW_BAND * 2 * WATER_PER_PERSON // days == 7
    const r = water(have, 2, target)
    assert.closeTo(r.days ?? -1, target * YELLOW_BAND, 1e-9)
    assert.equal(r.status, 'yellow')
  })

  test('days between band and target → yellow', ({ assert }) => {
    const target = 14
    const have = 10 * 2 * WATER_PER_PERSON // days == 10, between 7 and 14
    const r = water(have, 2, target)
    assert.equal(r.status, 'yellow')
  })

  test('days just below the band → red', ({ assert }) => {
    const target = 14
    const have = (target * YELLOW_BAND - 0.01) * 2 * WATER_PER_PERSON
    const r = water(have, 2, target)
    assert.equal(r.status, 'red')
  })

  test('zero have with a set need → days 0, status red', ({ assert }) => {
    const r = water(0, 2)
    assert.equal(r.days, 0)
    assert.equal(r.status, 'red')
  })

  test('large have → green', ({ assert }) => {
    const r = water(100000, 2)
    assert.equal(r.status, 'green')
    assert.equal(r.gapBase, 0)
  })
})

test.group('readiness · unset / divide-by-zero guard', () => {
  test('dailyNeed <= 0 (zero people, zero need) → unset, days null, gap 0', ({ assert }) => {
    const r = computeResourceReadiness('power', 500, 0, 0, 0, 14)
    assert.equal(r.status, 'unset')
    assert.equal(r.days, null)
    assert.equal(r.dailyNeed, 0)
    assert.equal(r.gapBase, 0)
  })

  test('power default 0 with people present still → unset (no per-person power)', ({ assert }) => {
    // 4 people but perPersonNeed 0 (power default) → dailyNeed 0, no divide.
    const r = computeResourceReadiness('power', 1000, 4, 0, 0, 14)
    assert.equal(r.status, 'unset')
    assert.equal(r.days, null)
  })

  test('no NaN / Infinity ever escapes the guard', ({ assert }) => {
    const r = computeResourceReadiness('water', 200, 0, 0, 0, 14)
    assert.isFalse(Number.isNaN(r.dailyNeed))
    assert.equal(r.days, null)
    assert.isFinite(r.gapBase)
  })
})

test.group('readiness · gap arithmetic', () => {
  test('gap = target*dailyNeed - have when short of target', ({ assert }) => {
    const target = 14
    const people = 2
    const dailyNeed = people * WATER_PER_PERSON
    const have = 100
    const r = water(have, people, target)
    assert.closeTo(r.gapBase, target * dailyNeed - have, 1e-9)
  })

  test('worked example (spec §5.3 adapted to no-multiplier model)', ({ assert }) => {
    // 2 adults + 2 children = 4 full persons, 1 pet at 0 L (user enters intake).
    // dailyNeed = 4 * 3.785411784 ≈ 15.14 L/day. have = 200 L.
    const r = water(200, 4, 14)
    assert.closeTo(r.dailyNeed, 4 * WATER_PER_PERSON, 1e-9)
    // days = 200 / 15.14 ≈ 13.2 → yellow (between 7 and 14), gap > 0.
    assert.equal(r.status, 'yellow')
    assert.closeTo(r.gapBase, 14 * 4 * WATER_PER_PERSON - 200, 1e-9)
  })

  test('gap is 0 (never negative) when supply exceeds target', ({ assert }) => {
    const r = water(100000, 2)
    assert.equal(r.gapBase, 0)
  })

  test('gap is 0 when the need is unset', ({ assert }) => {
    const r = computeResourceReadiness('power', 500, 2, 0, 0, 14)
    assert.equal(r.gapBase, 0)
  })
})

test.group('readiness · input clamping (defense against bad KV/DB values)', () => {
  test('negative have is floored to 0', ({ assert }) => {
    const r = water(-50, 2)
    assert.equal(r.haveBase, 0)
    assert.equal(r.days, 0)
    assert.equal(r.status, 'red')
  })

  test('NaN have is floored to 0', ({ assert }) => {
    const r = water(Number.NaN, 2)
    assert.equal(r.haveBase, 0)
  })

  test('every resource type round-trips its tag', ({ assert }) => {
    const resources: ReadinessResource[] = ['water', 'food', 'power']
    for (const res of resources) {
      const r = computeResourceReadiness(res, 10, 2, 5, 0, 14)
      assert.equal(r.resource, res)
    }
  })
})
