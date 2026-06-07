import { test } from '@japa/runner'
import {
  toBase,
  fromBase,
  displayUnitLabel,
  isLowStock,
  isExpiringWithin,
} from '../../util/units.js'

const US_GALLON_IN_LITERS = 3.785411784

test.group('units · toBase / fromBase — water', () => {
  test('US water: 1 gal → 3.785411784 L', ({ assert }) => {
    assert.closeTo(toBase('water', 1, 'us'), US_GALLON_IN_LITERS, 1e-9)
  })

  test('US water: 2.5 gal → ~9.46 L', ({ assert }) => {
    assert.closeTo(toBase('water', 2.5, 'us'), 2.5 * US_GALLON_IN_LITERS, 1e-9)
  })

  test('metric water is identity (already liters)', ({ assert }) => {
    assert.equal(toBase('water', 200, 'metric'), 200)
    assert.equal(fromBase('water', 200, 'metric'), 200)
  })

  test('US water round-trip: fromBase(toBase(x)) ≈ x', ({ assert }) => {
    for (const x of [0, 1, 2.5, 17.3, 1000]) {
      assert.closeTo(fromBase('water', toBase('water', x, 'us'), 'us'), x, 1e-9)
    }
  })

  test('fromBase US water: 3.785411784 L → 1 gal', ({ assert }) => {
    assert.closeTo(fromBase('water', US_GALLON_IN_LITERS, 'us'), 1, 1e-9)
  })
})

test.group('units · toBase / fromBase — food + power identity', () => {
  test('food is identity in both systems', ({ assert }) => {
    assert.equal(toBase('food', 2000, 'us'), 2000)
    assert.equal(toBase('food', 2000, 'metric'), 2000)
    assert.equal(fromBase('food', 2000, 'us'), 2000)
    assert.equal(fromBase('food', 2000, 'metric'), 2000)
  })

  test('power is identity in both systems', ({ assert }) => {
    assert.equal(toBase('power', 500, 'us'), 500)
    assert.equal(toBase('power', 500, 'metric'), 500)
    assert.equal(fromBase('power', 500, 'us'), 500)
    assert.equal(fromBase('power', 500, 'metric'), 500)
  })

  test('food/power round-trip is exact', ({ assert }) => {
    assert.equal(fromBase('food', toBase('food', 1234, 'us'), 'us'), 1234)
    assert.equal(fromBase('power', toBase('power', 9876, 'metric'), 'metric'), 9876)
  })
})

test.group('units · displayUnitLabel', () => {
  test('water labels differ by system', ({ assert }) => {
    assert.equal(displayUnitLabel('water', 'us'), 'gal')
    assert.equal(displayUnitLabel('water', 'metric'), 'L')
  })

  test('food is kcal in both systems', ({ assert }) => {
    assert.equal(displayUnitLabel('food', 'us'), 'kcal')
    assert.equal(displayUnitLabel('food', 'metric'), 'kcal')
  })

  test('power is Wh in both systems', ({ assert }) => {
    assert.equal(displayUnitLabel('power', 'us'), 'Wh')
    assert.equal(displayUnitLabel('power', 'metric'), 'Wh')
  })
})

test.group('units · isLowStock', () => {
  test('quantity below threshold is low', ({ assert }) => {
    assert.isTrue(isLowStock(2, 5))
  })

  test('quantity above threshold is not low', ({ assert }) => {
    assert.isFalse(isLowStock(6, 5))
  })

  test('quantity exactly at threshold is low (inclusive)', ({ assert }) => {
    assert.isTrue(isLowStock(5, 5))
  })

  test('null threshold is never low (untracked)', ({ assert }) => {
    assert.isFalse(isLowStock(0, null))
    assert.isFalse(isLowStock(999, null))
  })
})

test.group('units · isExpiringWithin', () => {
  const today = new Date(Date.UTC(2026, 5, 7)) // 2026-06-07

  test('expiry inside the window is true', ({ assert }) => {
    assert.isTrue(isExpiringWithin('2026-06-20', 30, today))
  })

  test('expiry beyond the window is false', ({ assert }) => {
    assert.isFalse(isExpiringWithin('2026-08-01', 30, today))
  })

  test('boundary: exactly N days away is inclusive', ({ assert }) => {
    // today + 30 days = 2026-07-07
    assert.isTrue(isExpiringWithin('2026-07-07', 30, today))
    // one day past the window
    assert.isFalse(isExpiringWithin('2026-07-08', 30, today))
  })

  test('a past expiry date counts as expiring', ({ assert }) => {
    assert.isTrue(isExpiringWithin('2026-01-01', 30, today))
  })

  test('today itself is within any non-negative window', ({ assert }) => {
    assert.isTrue(isExpiringWithin('2026-06-07', 0, today))
  })

  test('null expiry is never expiring', ({ assert }) => {
    assert.isFalse(isExpiringWithin(null, 30, today))
    assert.isFalse(isExpiringWithin('', 30, today))
  })

  test('full ISO timestamp is compared date-only', ({ assert }) => {
    assert.isTrue(isExpiringWithin('2026-06-20T23:59:00.000Z', 30, today))
  })

  test('unparseable date is never expiring', ({ assert }) => {
    assert.isFalse(isExpiringWithin('not-a-date', 30, today))
  })
})
