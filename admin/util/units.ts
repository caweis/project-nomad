/**
 * Self-Reliance Suite — pure unit-conversion + inventory predicates.
 *
 * No DB, no Adonis imports — the embed_jobs.ts shape, so this is unit-testable
 * without booting AdonisJS/MySQL/Redis (the local test contract; see the suite
 * design spec §8).
 *
 * Every resource amount (resource_contribution, and in Phase 2 the household
 * needs) is STORED in a fixed base unit per resource_type:
 *   • water → liters (L)
 *   • food  → kilocalories (kcal)
 *   • power → watt-hours (Wh)
 *
 * The user enters/sees the value in their DISPLAY unit, which depends on the
 * measurement system. toBase converts display → stored; fromBase converts
 * stored → display. The calculator always runs in base units, so the chosen
 * system never changes the math — switching is lossless and retroactive.
 *
 * Only water differs between systems today (US gallon vs liter). food and power
 * are system-agnostic (kcal/Wh) and route through the same signature as an
 * identity conversion, so adding a future divergence is a one-line change here,
 * not a new code path at every call site.
 */

export type MeasurementSystem = 'us' | 'metric'
export type ResourceType = 'water' | 'food' | 'power'

/** US gallon → liters. The US customary gallon, NOT the UK imperial gallon (4.546 L). */
const US_GALLON_IN_LITERS = 3.785411784

/**
 * Display→base factor for each (resource, system). Multiply a display value by
 * this to get the stored base value; divide a base value by this to display it.
 * Identity (1) everywhere except US water, which is in gallons.
 */
function displayToBaseFactor(resource: ResourceType, system: MeasurementSystem): number {
  if (resource === 'water' && system === 'us') return US_GALLON_IN_LITERS
  // metric water = identity (already liters); food/power identity in both systems.
  return 1
}

/**
 * Convert a value the user typed in their display unit into the stored base unit.
 */
export function toBase(resource: ResourceType, value: number, system: MeasurementSystem): number {
  return value * displayToBaseFactor(resource, system)
}

/**
 * Convert a stored base-unit value back into the user's display unit (for forms/grid).
 */
export function fromBase(
  resource: ResourceType,
  baseValue: number,
  system: MeasurementSystem
): number {
  return baseValue / displayToBaseFactor(resource, system)
}

/**
 * The display-unit label for a resource under a system, e.g.
 * ('water','us') => 'gal', ('water','metric') => 'L'.
 */
export function displayUnitLabel(resource: ResourceType, system: MeasurementSystem): string {
  switch (resource) {
    case 'water':
      return system === 'us' ? 'gal' : 'L'
    case 'food':
      return 'kcal'
    case 'power':
      return 'Wh'
  }
}

/**
 * Row-level low-stock predicate — pure, used to badge cards. Low stock means
 * a threshold is set AND the on-hand quantity has fallen to/below it. A null
 * threshold means "don't track low stock for this item" → never low.
 */
export function isLowStock(quantity: number, restockThreshold: number | null): boolean {
  if (restockThreshold === null) return false
  return quantity <= restockThreshold
}

/**
 * "Expiring within N days" predicate against a reference date. Date-only
 * comparison (expiry_date carries no time component). A null expiry never
 * counts as expiring. An already-past expiry counts (it's within any window).
 * The boundary (exactly N days away) is inclusive.
 *
 * expiryDate is an ISO date string (YYYY-MM-DD or a full ISO timestamp); only
 * the calendar date is compared, so timezone-of-day never flips the result.
 */
export function isExpiringWithin(expiryDate: string | null, days: number, today: Date): boolean {
  if (expiryDate === null || expiryDate === '') return false

  const expiry = parseDateOnly(expiryDate)
  if (expiry === null) return false

  const todayDate = toUtcMidnight(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const horizon = todayDate + days * MS_PER_DAY

  return expiry <= horizon
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Parse the leading YYYY-MM-DD of an ISO string into a UTC-midnight epoch ms, or null. */
function parseDateOnly(iso: string): number | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  return toUtcMidnight(year, month, day)
}

function toUtcMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day)
}
