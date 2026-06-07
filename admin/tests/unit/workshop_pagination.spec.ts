import { test } from '@japa/runner'
import { pageList } from '../../util/workshop_pagination.js'

test.group('pageList — small ranges (no ellipsis)', () => {
  test('single page', ({ assert }) => {
    assert.deepEqual(pageList(1, 1), [1])
  })

  test('all pages shown when last <= window', ({ assert }) => {
    assert.deepEqual(pageList(1, 5), [1, 2, 3, 4, 5])
    assert.deepEqual(pageList(3, 5), [1, 2, 3, 4, 5])
    assert.deepEqual(pageList(5, 5), [1, 2, 3, 4, 5])
  })

  test('seven pages fits entirely under the default threshold', ({ assert }) => {
    // last (7) <= boundaries*2 + siblings*2 + 3 = 7, so render every page —
    // an ellipsis here would hide nothing.
    assert.deepEqual(pageList(4, 7), [1, 2, 3, 4, 5, 6, 7])
    assert.deepEqual(pageList(1, 7), [1, 2, 3, 4, 5, 6, 7])
    assert.deepEqual(pageList(7, 7), [1, 2, 3, 4, 5, 6, 7])
  })
})

test.group('pageList — large ranges (ellipsis)', () => {
  test('current near start → trailing ellipsis only', ({ assert }) => {
    assert.deepEqual(pageList(1, 10), [1, 2, '…', 10])
    assert.deepEqual(pageList(2, 10), [1, 2, 3, '…', 10])
  })

  test('current in the middle → leading and trailing ellipsis', ({ assert }) => {
    assert.deepEqual(pageList(5, 10), [1, '…', 4, 5, 6, '…', 10])
  })

  test('current near end → leading ellipsis only', ({ assert }) => {
    assert.deepEqual(pageList(10, 10), [1, '…', 9, 10])
    assert.deepEqual(pageList(9, 10), [1, '…', 8, 9, 10])
  })

  test('a one-page gap collapses to the number, not an ellipsis', ({ assert }) => {
    // current=3, last=10: boundaries {1,10}, window {2,3,4}.
    // 1→2 is adjacent; 4→10 is a real gap (ellipsis). The 1-2 side stays solid.
    assert.deepEqual(pageList(3, 10), [1, 2, 3, 4, '…', 10])
  })
})

test.group('pageList — clamping', () => {
  test('current above last is clamped to last', ({ assert }) => {
    assert.deepEqual(pageList(99, 10), pageList(10, 10))
  })

  test('current below 1 is clamped to 1', ({ assert }) => {
    assert.deepEqual(pageList(0, 10), pageList(1, 10))
    assert.deepEqual(pageList(-5, 10), pageList(1, 10))
  })

  test('last below 1 is treated as a single page', ({ assert }) => {
    assert.deepEqual(pageList(1, 0), [1])
    assert.deepEqual(pageList(3, -2), [1])
  })

  test('non-integer inputs are floored', ({ assert }) => {
    assert.deepEqual(pageList(2.9, 5.9), pageList(2, 5))
  })
})

test.group('pageList — option overrides', () => {
  test('wider sibling window', ({ assert }) => {
    // boundaries{1,20} + window{3..7}; the 1→3 gap is a single page so it
    // collapses to "2" rather than an ellipsis.
    assert.deepEqual(pageList(5, 20, { siblings: 2 }), [1, 2, 3, 4, 5, 6, 7, '…', 20])
  })

  test('more boundary pages', ({ assert }) => {
    assert.deepEqual(pageList(10, 20, { boundaries: 2 }), [1, 2, '…', 9, 10, 11, '…', 19, 20])
  })
})
