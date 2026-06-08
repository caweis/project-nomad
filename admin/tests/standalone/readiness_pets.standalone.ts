/**
 * Standalone gate test for the typed-pet readiness pure helpers.
 *
 * Japa cannot boot locally without MySQL/Redis, so this file exercises the pure
 * helpers (computePetLoad, petPersonEquivalent, daysWithoutPets) directly under
 * `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/readiness_pets.standalone.ts
 *
 * Also smoke-checks the shipped PET_NEEDS table (admin/app/data/pet_needs.ts)
 * is complete, base-unit-positive for the typed species, and cited.
 */
import assert from 'node:assert/strict'
import {
  computePetLoad,
  petPersonEquivalent,
  daysWithoutPets,
  type PetNeedRates,
  type PetLoadEntry,
} from '../../util/readiness.ts'
import { PET_NEEDS, PET_TYPES, PET_TYPE_LABELS } from '../../app/data/pet_needs.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// A small fixture rates table mirroring PET_NEEDS' shape.
const RATES: Record<string, PetNeedRates> = {
  dog: { waterL: 1.0, kcal: 800 },
  cat: { waterL: 0.25, kcal: 250 },
  other: { waterL: 0, kcal: 0 }, // 'other' is overridden by the entry's own figures
}

// ── computePetLoad ────────────────────────────────────────────────────────────
check('computePetLoad sums count * per-pet rate across types', () => {
  const pets: PetLoadEntry[] = [
    { type: 'dog', count: 2 },
    { type: 'cat', count: 3 },
  ]
  const load = computePetLoad(pets, RATES)
  assert.equal(load.waterL, 2 * 1.0 + 3 * 0.25)
  assert.equal(load.kcal, 2 * 800 + 3 * 250)
})

check('computePetLoad uses entry figures for an unknown type (other)', () => {
  // 'other' has zero rate, so the entry's own waterL/kcal drive the total.
  const pets: PetLoadEntry[] = [{ type: 'other', count: 2, waterL: 0.5, kcal: 100 }]
  const load = computePetLoad(pets, RATES)
  assert.equal(load.waterL, 2 * 0.5)
  assert.equal(load.kcal, 2 * 100)
})

check('computePetLoad uses entry figures when the type is absent from rates', () => {
  const pets: PetLoadEntry[] = [{ type: 'iguana', count: 1, waterL: 0.05, kcal: 30 }]
  const load = computePetLoad(pets, RATES)
  assert.equal(load.waterL, 0.05)
  assert.equal(load.kcal, 30)
})

check('computePetLoad skips zero-count rows', () => {
  const pets: PetLoadEntry[] = [
    { type: 'dog', count: 0 },
    { type: 'cat', count: 2 },
  ]
  const load = computePetLoad(pets, RATES)
  assert.equal(load.waterL, 2 * 0.25)
  assert.equal(load.kcal, 2 * 250)
})

check('computePetLoad clamps negative / NaN counts and figures to 0', () => {
  const pets: PetLoadEntry[] = [
    { type: 'dog', count: -3 },
    { type: 'other', count: Number.NaN, waterL: 1, kcal: 1 },
    { type: 'other', count: 2, waterL: -1, kcal: Number.NaN },
  ]
  const load = computePetLoad(pets, RATES)
  assert.equal(load.waterL, 0)
  assert.equal(load.kcal, 0)
})

check('computePetLoad on an empty list is zero', () => {
  const load = computePetLoad([], RATES)
  assert.deepEqual(load, { waterL: 0, kcal: 0 })
})

// ── petPersonEquivalent ───────────────────────────────────────────────────────
check('petPersonEquivalent divides pet total by the per-person need', () => {
  // 2 L of pet water at a 4 L/person/day need ≈ 0.5 people.
  assert.equal(petPersonEquivalent(2, 4), 0.5)
})

check('petPersonEquivalent returns 0 when the per-person need is unset', () => {
  assert.equal(petPersonEquivalent(2, 0), 0)
  assert.equal(petPersonEquivalent(2, -1), 0)
})

check('petPersonEquivalent floors a negative pet total to 0', () => {
  assert.equal(petPersonEquivalent(-5, 4), 0)
})

// ── daysWithoutPets ───────────────────────────────────────────────────────────
check('daysWithoutPets strips the pet term from the daily need', () => {
  // 40 L on hand, 2 people * 4 L/person = 8 L/day → 5 days, ignoring pets.
  assert.equal(daysWithoutPets(40, 2, 4), 5)
})

check('daysWithoutPets is null when the people-only need is zero', () => {
  assert.equal(daysWithoutPets(40, 0, 4), null)
  assert.equal(daysWithoutPets(40, 2, 0), null)
})

check('daysWithoutPets differs from days-with-pets (the with/without contrast)', () => {
  const have = 40
  const people = 2
  const perPerson = 4
  const petLoad = computePetLoad([{ type: 'dog', count: 1 }], RATES) // +1.0 L water
  const without = daysWithoutPets(have, people, perPerson)!
  const withPets = have / (people * perPerson + petLoad.waterL)
  assert.ok(without > withPets, 'without-pets days should exceed with-pets days')
  assert.equal(without, 5)
})

// ── shipped PET_NEEDS smoke check ─────────────────────────────────────────────
check('PET_NEEDS covers every PET_TYPE with a label', () => {
  for (const t of PET_TYPES) {
    assert.ok(PET_NEEDS[t], `missing PET_NEEDS entry for ${t}`)
    assert.ok(PET_TYPE_LABELS[t], `missing label for ${t}`)
  }
})

check('typed species have positive water + calories and a non-empty source', () => {
  for (const t of PET_TYPES) {
    const need = PET_NEEDS[t]
    assert.ok(need.source.length > 0, `empty source for ${t}`)
    if (t === 'other') {
      assert.equal(need.waterL, 0)
      assert.equal(need.kcal, 0)
    } else {
      assert.ok(need.waterL > 0, `non-positive water for ${t}`)
      assert.ok(need.kcal > 0, `non-positive kcal for ${t}`)
    }
  }
})

check('computePetLoad against the shipped PET_NEEDS matches the cited dog figures', () => {
  const load = computePetLoad([{ type: 'dog', count: 2 }], PET_NEEDS)
  assert.equal(load.waterL, 2 * 1.0)
  assert.equal(load.kcal, 2 * 800)
})

console.log(`\n${passed} checks passed`)
