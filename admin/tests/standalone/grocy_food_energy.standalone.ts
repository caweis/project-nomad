/**
 * Standalone gate test for the pure Grocy food-energy computation.
 *
 * Japa cannot boot locally without MySQL/Redis, so this exercises the pure
 * helper directly under `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/grocy_food_energy.standalone.ts
 *
 * Covers the honest-v1 contract: total kcal on hand = Σ(calories × amount) over
 * products that HAVE calorie data, plus coverage counts so the readiness UI can
 * say "N of M products have calorie data" rather than fabricate a food-days
 * number. Grocy's `calories` is optional and usually unset (issues #1241/#1682),
 * and does not roll up parent→child — so we use the non-aggregated stock amount
 * and never count a product without usable calorie data.
 */
import assert from 'node:assert/strict'
import {
  computeFoodEnergy,
  selectFoodNumerator,
  type GrocyProduct,
  type GrocyStockRow,
} from '../../util/grocy_food_energy.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const products: GrocyProduct[] = [
  { id: 1, calories: 250 }, // kcal per stock unit
  { id: 2, calories: 0 }, //   no usable calories
  { id: 3, calories: null }, // unset
  { id: 4, calories: 130 },
]

check('sums calories x amount over products with calorie data', () => {
  const stock: GrocyStockRow[] = [
    { product_id: 1, amount: 4 }, // 1000
    { product_id: 4, amount: 2 }, // 260
  ]
  const e = computeFoodEnergy(products, stock)
  assert.equal(e.totalKcal, 4 * 250 + 2 * 130)
  assert.equal(e.covered, 2)
  assert.equal(e.total, 2)
})

check('products without calorie data lower coverage and add 0 kcal', () => {
  const stock: GrocyStockRow[] = [
    { product_id: 1, amount: 1 }, // 250, covered
    { product_id: 2, amount: 5 }, // 0 cal -> 0, not covered
    { product_id: 3, amount: 3 }, // null -> 0, not covered
  ]
  const e = computeFoodEnergy(products, stock)
  assert.equal(e.totalKcal, 250)
  assert.equal(e.covered, 1)
  assert.equal(e.total, 3)
})

check('stock rows with no matching product are skipped entirely', () => {
  const stock: GrocyStockRow[] = [
    { product_id: 99, amount: 10 }, // unknown product
    { product_id: 1, amount: 2 }, // 500
  ]
  const e = computeFoodEnergy(products, stock)
  assert.equal(e.totalKcal, 500)
  assert.equal(e.covered, 1)
  assert.equal(e.total, 1) // the unknown product is not counted
})

check('non-positive amounts do not count as covered', () => {
  const stock: GrocyStockRow[] = [{ product_id: 1, amount: 0 }]
  const e = computeFoodEnergy(products, stock)
  assert.equal(e.totalKcal, 0)
  assert.equal(e.covered, 0)
  assert.equal(e.total, 1) // present with a product record, but amount 0 -> not covered
})

check('empty stock yields zeros', () => {
  const e = computeFoodEnergy(products, [])
  assert.equal(e.totalKcal, 0)
  assert.equal(e.covered, 0)
  assert.equal(e.total, 0)
})

check('selectFoodNumerator: Grocy present uses its kcal + coverage, ignores inventory', () => {
  const n = selectFoodNumerator({ totalKcal: 5000, covered: 3, total: 8 }, 9999)
  assert.equal(n.foodHave, 5000)
  assert.equal(n.foodSource, 'grocy')
  assert.deepEqual(n.grocyCoverage, { covered: 3, total: 8 })
})

check('selectFoodNumerator: Grocy absent falls back to inventory, no coverage', () => {
  const n = selectFoodNumerator(null, 4200)
  assert.equal(n.foodHave, 4200)
  assert.equal(n.foodSource, 'inventory')
  assert.equal(n.grocyCoverage, undefined)
})

console.log(`\n${passed} checks passed`)
