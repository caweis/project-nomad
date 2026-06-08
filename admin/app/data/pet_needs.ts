/**
 * Self-Reliance Suite — typical-adult per-pet daily needs (runtime source of truth).
 *
 * A small, cited table of per-pet/day water and food for common companion
 * animals, used by the Readiness Calculator to estimate a household's pet load
 * without asking the user to compute gallons and calories by hand. Each entry is
 * a TYPICAL ADULT estimate for an average-weight animal — real needs vary with
 * body weight, life stage, and activity, so the UI carries a "needs vary with
 * weight" caveat and the 'other' type lets the user enter exact figures.
 *
 * Units are BASE units, matching util/readiness.ts and util/units.ts:
 *   • water → liters (L) per pet per day
 *   • food  → kilocalories (kcal) per pet per day
 *
 * WHY a TS constant (not a runtime JSON read): same reasoning as conditions.ts —
 * the Dockerfile ships only the compiled admin/build output, so a repo-root JSON
 * file never reaches the container. Bundling the table as a compiled module
 * guarantees it is always present at runtime.
 *
 * Each `source` records the basis for the two figures. Water draws on
 * milliliters-per-kilogram-per-day veterinary maintenance ranges (Merck/MSD
 * Veterinary Manual); calories draw on the resting energy requirement
 * RER = 70 * weight_kg^0.75, scaled by a maintenance factor (AAHA/WSAVA), at the
 * stated reference weight. These are estimates for provisioning, not veterinary
 * dosing.
 */

import type { PetNeed, PetType } from '../../types/readiness.js'

/** The selectable pet types, in display order. 'other' is the manual-entry escape hatch. */
export const PET_TYPES: PetType[] = [
  'dog',
  'cat',
  'rabbit',
  'guineaPig',
  'ferret',
  'bird',
  'other',
]

/** Human-facing labels for the pet-type dropdown. */
export const PET_TYPE_LABELS: Record<PetType, string> = {
  dog: 'Dog',
  cat: 'Cat',
  rabbit: 'Rabbit',
  guineaPig: 'Guinea pig',
  ferret: 'Ferret',
  bird: 'Bird',
  other: 'Other',
}

/**
 * Per-pet/day needs in BASE units (water L, food kcal) for a typical adult.
 * 'other' is 0/0 here — the user supplies its per-pet figures inline.
 */
export const PET_NEEDS: Record<PetType, PetNeed> = {
  dog: {
    waterL: 1.0,
    kcal: 800,
    source:
      'Water 60-80 mL/kg/day (Merck/MSD Vet Manual); calories RER=70*kg^0.75 * MER ~1.5 (AAHA/WSAVA); ~15 kg adult',
  },
  cat: {
    waterL: 0.25,
    kcal: 250,
    source: 'Water 50-60 mL/kg/day (Merck/MSD); RER*~1.2; ~4.5 kg',
  },
  rabbit: {
    waterL: 0.24,
    kcal: 150,
    source: 'Water ~120 mL/kg (MSD); RER=70*kg^0.75; ~2 kg',
  },
  guineaPig: {
    waterL: 0.1,
    kcal: 140,
    source: 'Water ~100 mL/kg (NCBI/MSD); MEm ~149 kcal/kg^0.75; ~1 kg',
  },
  ferret: {
    waterL: 0.1,
    kcal: 250,
    source: '200-300 kcal/kg/day (ferret nutrition refs); water ~3x food; ~1 kg',
  },
  bird: {
    waterL: 0.01,
    kcal: 12,
    source: 'MR=78*kg^0.75 (nonpasserine/psittacine); water ~50 mL/kg; small companion ~0.1 kg',
  },
  other: {
    waterL: 0,
    kcal: 0,
    source: 'User-entered per-pet water (L) and calories (kcal) — no built-in estimate.',
  },
}
