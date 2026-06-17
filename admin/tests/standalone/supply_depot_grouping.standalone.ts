/**
 * Standalone gate test for the Supply Depot category-grouping pure helper.
 *
 * Japa cannot boot locally without MySQL/Redis, and the helper lives under
 * inertia/ (excluded from the root tsconfig), so this file exercises
 * groupServicesByCategory directly under `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/supply_depot_grouping.standalone.ts
 *
 * Covers: known categories sort to the fixed CATEGORY_ORDER; null/empty ->
 * Other (last); unknown categories appended (alphabetically) ahead of Other;
 * within-group display_order preserved; empty input -> []; labels resolve.
 */
import assert from 'node:assert/strict'
import {
  groupServicesByCategory,
  labelForCategory,
  CATEGORY_ORDER,
  OTHER_CATEGORY,
  type GroupableService,
} from '../../inertia/lib/supplyDepot.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// Helper to build a row tersely.
function svc(category: string | null, display_order: number): GroupableService {
  return { category, display_order }
}

// ── ordering of known categories ──────────────────────────────────────────────
check('known categories sort to the fixed CATEGORY_ORDER', () => {
  // Feed them out of order; expect ai, productivity, utility, education, networking.
  const groups = groupServicesByCategory([
    svc('networking', 1),
    svc('education', 1),
    svc('utility', 1),
    svc('productivity', 1),
    svc('ai', 1),
  ])
  assert.deepEqual(
    groups.map((g) => g.category),
    ['ai', 'productivity', 'utility', 'education', 'networking']
  )
})

check('CATEGORY_ORDER is the documented sequence', () => {
  assert.deepEqual(
    [...CATEGORY_ORDER],
    ['ai', 'productivity', 'utility', 'education', 'networking', 'security']
  )
})

// ── Other bucket ──────────────────────────────────────────────────────────────
check('null category buckets to Other', () => {
  const groups = groupServicesByCategory([svc(null, 1)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].category, OTHER_CATEGORY)
  assert.equal(groups[0].label, 'Other')
})

check('empty-string / whitespace category buckets to Other', () => {
  const groups = groupServicesByCategory([svc('', 1), svc('   ', 2)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].category, OTHER_CATEGORY)
  assert.equal(groups[0].services.length, 2)
})

check('Other sorts dead last, after a known and an unknown category', () => {
  const groups = groupServicesByCategory([
    svc(null, 1), // Other
    svc('zzz-custom', 1), // unknown
    svc('ai', 1), // known, first
  ])
  assert.deepEqual(
    groups.map((g) => g.category),
    ['ai', 'zzz-custom', OTHER_CATEGORY]
  )
})

// ── unknown categories ────────────────────────────────────────────────────────
check('unknown categories are appended after the known block, alphabetically', () => {
  const groups = groupServicesByCategory([
    svc('beta', 1), // unknown
    svc('networking', 1), // known
    svc('alpha', 1), // unknown
    svc('ai', 1), // known, first
  ])
  assert.deepEqual(
    groups.map((g) => g.category),
    ['ai', 'networking', 'alpha', 'beta']
  )
})

// ── within-group display_order ────────────────────────────────────────────────
check('within a group, ascending display_order is preserved', () => {
  const groups = groupServicesByCategory([
    svc('ai', 5),
    svc('ai', 1),
    svc('ai', 3),
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].services.map((s) => s.display_order),
    [1, 3, 5]
  )
})

check('ties on display_order keep input (stable) order', () => {
  // Two rows in the same group with equal display_order: insertion order holds.
  type Tagged = GroupableService & { tag: string }
  const rows: Tagged[] = [
    { category: 'ai', display_order: 2, tag: 'a' },
    { category: 'ai', display_order: 2, tag: 'b' },
    { category: 'ai', display_order: 1, tag: 'c' },
  ]
  const groups = groupServicesByCategory(rows)
  assert.deepEqual(
    groups[0].services.map((s) => s.tag),
    ['c', 'a', 'b']
  )
})

// ── empty input + non-mutation ────────────────────────────────────────────────
check('empty input yields []', () => {
  assert.deepEqual(groupServicesByCategory([]), [])
})

check('empty groups are never emitted (only present categories appear)', () => {
  // Only one category present out of the whole CATEGORY_ORDER.
  const groups = groupServicesByCategory([svc('utility', 1)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].category, 'utility')
})

check('does not mutate the input array or rows', () => {
  const input = [svc('ai', 3), svc('ai', 1)]
  const snapshot = input.map((s) => ({ ...s }))
  groupServicesByCategory(input)
  assert.deepEqual(input, snapshot)
})

// ── labels ────────────────────────────────────────────────────────────────────
check('labelForCategory maps known keys and Title-cases unknowns', () => {
  assert.equal(labelForCategory('ai'), 'AI')
  assert.equal(labelForCategory('utility'), 'Utilities')
  assert.equal(labelForCategory('networking'), 'Networking')
  assert.equal(labelForCategory(OTHER_CATEGORY), 'Other')
  assert.equal(labelForCategory('home-automation'), 'Home Automation')
})

console.log(`\n${passed} checks passed`)
