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
