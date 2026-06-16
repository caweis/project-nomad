/**
 * Pure food-energy computation for the Grocy federated-readiness integration.
 *
 * Grocy's per-product `calories` field is kcal per ONE stock quantity-unit, so
 * total energy on hand is Σ(calories × stock amount) over the products that have
 * a calorie value — the stock units cancel, no unit conversion needed. Because
 * `calories` is optional and usually unset (Grocy issues #1241/#1682/#268) and
 * does NOT roll parent→child, we (a) use the non-aggregated stock `amount`, and
 * (b) report COVERAGE so the readiness UI can say "N of M products have calorie
 * data" instead of presenting a confident food-days number built on a handful of
 * filled-in products. Days-of-food-supply is a number people act on, so we never
 * fabricate the gap (Maxim 15).
 *
 * Kept framework-free (no AdonisJS imports) so it runs under the standalone gate
 * test (`node --experimental-strip-types`), like the other pure helpers in util/.
 */

export interface GrocyProduct {
  id: number
  /** kcal per one stock quantity-unit; null/0 when the user hasn't set it. */
  calories: number | null
}

export interface GrocyStockRow {
  product_id: number
  /** Current on-hand amount in the product's stock quantity-unit (non-aggregated). */
  amount: number
}

export interface FoodEnergy {
  /** Total kcal on hand across products that have usable calorie data. */
  totalKcal: number
  /** Products in stock that contributed kcal (calorie data present, amount > 0). */
  covered: number
  /** Products in stock that have a matching product record. */
  total: number
}

/**
 * Compute total food energy on hand plus coverage. `total` counts stock rows
 * that resolve to a product; `covered` counts those that actually contributed
 * kcal. A stock row with no matching product is ignored entirely (it has no
 * master record to read calories from).
 */
export function computeFoodEnergy(products: GrocyProduct[], stock: GrocyStockRow[]): FoodEnergy {
  const caloriesById = new Map<number, number | null>()
  for (const p of products) caloriesById.set(p.id, p.calories)

  let totalKcal = 0
  let covered = 0
  let total = 0

  for (const row of stock) {
    if (!caloriesById.has(row.product_id)) continue
    total++
    const cal = caloriesById.get(row.product_id) ?? 0
    if (cal > 0 && row.amount > 0) {
      totalKcal += cal * row.amount
      covered++
    }
  }

  return { totalKcal, covered, total }
}
