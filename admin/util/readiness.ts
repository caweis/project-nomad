/**
 * Self-Reliance Suite — Phase 2 Readiness Calculator pure helper.
 *
 * No DB, no Adonis imports — the embed_jobs.ts / units.ts shape, so this is
 * unit-testable without booting AdonisJS/MySQL/Redis (the local test contract;
 * see the suite design spec §8). ReadinessService supplies the inputs (KV config
 * + InventoryService.sumByResource); this module is the math.
 *
 * The model is the CITED one from spec §5.1.1, which SUPERSEDES the §5.1
 * placeholder multipliers:
 *   • Water 1 US gal (3.785411784 L) / person / day, drinking + sanitation —
 *     Ready.gov/water, FEMA "Food and Water in an Emergency" (FA-321), CDC.
 *   • Food 2000 kcal / person / day — FDA Nutrition Facts general reference.
 *   • Supply horizon 14 days (shelter-at-home) — American Red Cross + FEMA FA-321.
 *   • NO child or pet MULTIPLIER. Children count as FULL persons (FEMA/Ready.gov:
 *     children "will require even more"; never discount). Pets are user-entered
 *     daily intake totals, not a fabricated per-pet figure (AVMA gives durations
 *     only; the "1 oz/lb/day" rule is not from a primary authority).
 *   • Power has NO default and NO per-person standard — a user-entered daily Wh
 *     load only (0 = "not tracked", dormant, no divide-by-zero).
 *
 * All math runs in BASE units (water L, food kcal, power Wh); unit conversion to
 * the user's display system happens at the UI boundary via util/units.ts.
 *
 *   dailyNeed = people * perPersonNeed + petIntake
 *   days      = dailyNeed > 0 ? haveBase / dailyNeed : null
 *   gapBase   = max(0, targetDays * dailyNeed - haveBase)
 */

export type ReadinessResource = 'water' | 'food' | 'power'
export type ReadinessStatus = 'green' | 'yellow' | 'red' | 'unset'

/**
 * Yellow-band fraction of the target horizon: at or above target → green,
 * between (target * YELLOW_BAND) and target → yellow, below → red. Locked at
 * 0.5 per spec §9 Q8 (e.g. with a 14-day target, 7–13.9 days is yellow). Lives
 * in the pure helper so the threshold is one source of truth and is testable.
 */
export const YELLOW_BAND = 0.5

export interface ResourceReadiness {
  resource: ReadinessResource
  /** On-hand amount in base units (sum of contributing inventory rows). */
  haveBase: number
  /** Total need per day in base units: people * perPersonNeed + petIntake. */
  dailyNeed: number
  /** Days of supply at the current daily need; null when dailyNeed <= 0. */
  days: number | null
  /** The target horizon in days (echoed for the UI). */
  targetDays: number
  /** Traffic-light status (see YELLOW_BAND). 'unset' when no need is configured. */
  status: ReadinessStatus
  /** Base-unit amount short of the target (0 if met, or if the need is unset). */
  gapBase: number
}

/**
 * Compute one resource's readiness from already-summed inputs. Pure: the caller
 * (ReadinessService) supplies `haveBase` (InventoryService.sumByResource),
 * `people` (adults + children, BOTH full persons — no discount), the per-person
 * daily need in base units, and the pet daily intake total in base units
 * (water/food only; pass 0 for power, which has no pet term).
 *
 * Guards divide-by-zero: when the effective daily need is <= 0 (e.g. power left
 * at its 0 default), `days` is null, `status` is 'unset', and `gapBase` is 0 —
 * the dashboard renders a "set a daily need" prompt instead of NaN/Infinity.
 *
 * Non-finite or negative inputs are floored so a stray bad value can't produce
 * a nonsense status (`haveBase` and the need terms are clamped to >= 0).
 */
export function computeResourceReadiness(
  resource: ReadinessResource,
  haveBase: number,
  people: number,
  perPersonNeed: number,
  petIntake: number,
  targetDays: number
): ResourceReadiness {
  const have = clampNonNegative(haveBase)
  const peopleCount = clampNonNegative(people)
  const perPerson = clampNonNegative(perPersonNeed)
  // Power carries no pet term (§5.1.1): pets contribute to water + food only.
  const pets = resource === 'power' ? 0 : clampNonNegative(petIntake)
  const target = clampNonNegative(targetDays)

  const dailyNeed = peopleCount * perPerson + pets

  if (dailyNeed <= 0) {
    return {
      resource,
      haveBase: have,
      dailyNeed: 0,
      days: null,
      targetDays: target,
      status: 'unset',
      gapBase: 0,
    }
  }

  const days = have / dailyNeed
  const gapBase = Math.max(0, target * dailyNeed - have)

  let status: ReadinessStatus
  if (days >= target) {
    status = 'green'
  } else if (days >= target * YELLOW_BAND) {
    status = 'yellow'
  } else {
    status = 'red'
  }

  return {
    resource,
    haveBase: have,
    dailyNeed,
    days,
    targetDays: target,
    status,
    gapBase,
  }
}

/** Floor non-finite or negative numbers to 0 (defense against bad KV/DB input). */
function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

// ─── Typed-pet load (Phase 2 patch) ──────────────────────────────────────────

/**
 * Per-pet/day needs in BASE units (water L, food kcal). The shape app/data/
 * pet_needs.ts ships and the field this helper sums over. Kept here (not
 * imported from app/data) so the math stays dependency-free and unit-testable;
 * the caller supplies the table.
 */
export interface PetNeedRates {
  waterL: number
  kcal: number
}

/** A single pet row: a type key into the needs table, a count, and — for the
 * manual 'other' type — its own per-pet water/kcal that override the table. */
export interface PetLoadEntry {
  type: string
  count: number
  /** Per-pet water (L), used when the type isn't in the rates table (e.g. 'other'). */
  waterL?: number
  /** Per-pet food (kcal), used when the type isn't in the rates table. */
  kcal?: number
}

/** Total daily pet water + food in BASE units (L, kcal). */
export interface PetLoad {
  waterL: number
  kcal: number
}

/**
 * Sum a household's typed pets into total daily water (L) + food (kcal), both
 * BASE units. Per-pet figures resolve as: the entry's own `waterL`/`kcal` when
 * provided (the manual 'other' type, which has no built-in estimate), otherwise
 * the table rate `rates[type]` (the typed species). An unknown type with no
 * entry figures contributes nothing. Counts and per-pet figures are clamped
 * non-negative so a stray bad value can't produce a negative or NaN total.
 * Pure: the caller supplies `rates`.
 */
export function computePetLoad(
  pets: PetLoadEntry[],
  rates: Record<string, PetNeedRates>
): PetLoad {
  let waterL = 0
  let kcal = 0
  for (const pet of pets) {
    const count = clampNonNegative(pet.count)
    if (count === 0) continue
    const rate = rates[pet.type]
    // The entry's own figures (manual 'other') win over the table; fall back to
    // the table rate for typed species; 0 when neither is present.
    const perWater = pet.waterL !== undefined ? pet.waterL : (rate?.waterL ?? 0)
    const perKcal = pet.kcal !== undefined ? pet.kcal : (rate?.kcal ?? 0)
    waterL += count * clampNonNegative(perWater)
    kcal += count * clampNonNegative(perKcal)
  }
  return { waterL, kcal }
}

/**
 * The pet load expressed as a person-equivalent for one resource: how many
 * extra "people" the pet draw is worth at the per-person daily need. Returns 0
 * when the per-person need is unset (so the readout never divides by zero).
 */
export function petPersonEquivalent(petTotalBase: number, perPersonNeed: number): number {
  const need = clampNonNegative(perPersonNeed)
  if (need <= 0) return 0
  return clampNonNegative(petTotalBase) / need
}

/**
 * Days of supply WITHOUT the pet load, for the "X days (Y without pets)"
 * readout. Strips the pet term from the daily need (people * perPersonNeed only)
 * and recomputes days; null when that people-only need is <= 0.
 */
export function daysWithoutPets(
  haveBase: number,
  people: number,
  perPersonNeed: number
): number | null {
  const have = clampNonNegative(haveBase)
  const dailyNeed = clampNonNegative(people) * clampNonNegative(perPersonNeed)
  if (dailyNeed <= 0) return null
  return have / dailyNeed
}
