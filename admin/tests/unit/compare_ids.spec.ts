import { test } from '@japa/runner'
import { parseCompareIds, MAX_COMPARE } from '../../util/compare_ids.js'

// ─── parseCompareIds — basic CSV parsing ─────────────────────────────────────

test.group('parseCompareIds — basic CSV parsing', () => {
  test('single id', ({ assert }) => {
    assert.deepEqual(parseCompareIds('1'), [1])
  })

  test('multiple ids', ({ assert }) => {
    assert.deepEqual(parseCompareIds('1,2,3'), [1, 2, 3])
  })

  test('preserves order', ({ assert }) => {
    assert.deepEqual(parseCompareIds('5,3,1'), [5, 3, 1])
  })
})

// ─── parseCompareIds — whitespace handling ───────────────────────────────────

test.group('parseCompareIds — whitespace', () => {
  test('trims spaces around ids', ({ assert }) => {
    assert.deepEqual(parseCompareIds('  3 , 1 '), [3, 1])
  })

  test('handles tabs and mixed whitespace', ({ assert }) => {
    assert.deepEqual(parseCompareIds('\t2\t,\t4\t'), [2, 4])
  })
})

// ─── parseCompareIds — empty / blank input ───────────────────────────────────

test.group('parseCompareIds — empty input', () => {
  test('empty string returns []', ({ assert }) => {
    assert.deepEqual(parseCompareIds(''), [])
  })

  test('whitespace-only returns []', ({ assert }) => {
    assert.deepEqual(parseCompareIds('   '), [])
  })

  test('trailing comma drops empty segment', ({ assert }) => {
    assert.deepEqual(parseCompareIds('1,2,'), [1, 2])
  })

  test('leading comma drops empty segment', ({ assert }) => {
    assert.deepEqual(parseCompareIds(',1,2'), [1, 2])
  })

  test('double comma drops empty segment', ({ assert }) => {
    assert.deepEqual(parseCompareIds('1,,2'), [1, 2])
  })
})

// ─── parseCompareIds — invalid / non-integer values dropped ──────────────────

test.group('parseCompareIds — invalid values dropped', () => {
  test('non-numeric string is dropped', ({ assert }) => {
    assert.deepEqual(parseCompareIds('abc'), [])
  })

  test('float is dropped', ({ assert }) => {
    assert.deepEqual(parseCompareIds('1.5'), [])
    assert.deepEqual(parseCompareIds('2.0'), [])
  })

  test('zero is dropped', ({ assert }) => {
    assert.deepEqual(parseCompareIds('0'), [])
  })

  test('negative integer is dropped', ({ assert }) => {
    assert.deepEqual(parseCompareIds('-1'), [])
    assert.deepEqual(parseCompareIds('-5'), [])
  })

  test('mixed valid and invalid — only valid returned', ({ assert }) => {
    assert.deepEqual(parseCompareIds('0,-1,abc,1.5,2,'), [2])
  })

  test('NaN string is dropped', ({ assert }) => {
    assert.deepEqual(parseCompareIds('NaN'), [])
  })

  test('Infinity string is dropped', ({ assert }) => {
    assert.deepEqual(parseCompareIds('Infinity'), [])
  })
})

// ─── parseCompareIds — dedupe (preserving first-occurrence order) ─────────────

test.group('parseCompareIds — dedupe', () => {
  test('duplicate ids are dropped (first occurrence kept)', ({ assert }) => {
    assert.deepEqual(parseCompareIds('2,1,2'), [2, 1])
  })

  test('all same id collapses to one', ({ assert }) => {
    assert.deepEqual(parseCompareIds('3,3,3'), [3])
  })

  test('deduplication preserves first-occurrence order', ({ assert }) => {
    assert.deepEqual(parseCompareIds('5,3,5,1,3'), [5, 3, 1])
  })
})

// ─── parseCompareIds — cap at MAX_COMPARE ────────────────────────────────────

test.group(`parseCompareIds — cap at MAX_COMPARE (${MAX_COMPARE})`, () => {
  test(`exactly ${MAX_COMPARE} ids pass through`, ({ assert }) => {
    const input = Array.from({ length: MAX_COMPARE }, (_, i) => i + 1).join(',')
    assert.deepEqual(
      parseCompareIds(input),
      Array.from({ length: MAX_COMPARE }, (_, i) => i + 1)
    )
  })

  test(`${MAX_COMPARE + 1} ids are capped to first ${MAX_COMPARE}`, ({ assert }) => {
    const ids = Array.from({ length: MAX_COMPARE + 1 }, (_, i) => i + 1)
    const result = parseCompareIds(ids.join(','))
    assert.equal(result.length, MAX_COMPARE)
    assert.deepEqual(result, ids.slice(0, MAX_COMPARE))
  })

  test('7 ids capped to 5', ({ assert }) => {
    const result = parseCompareIds('10,20,30,40,50,60,70')
    assert.equal(result.length, MAX_COMPARE)
    assert.deepEqual(result, [10, 20, 30, 40, 50])
  })

  test('dedupe then cap — deduped first, then capped', ({ assert }) => {
    // 2,1,2,3,4,5,6 → after dedupe [2,1,3,4,5,6] → cap → [2,1,3,4,5]
    const result = parseCompareIds('2,1,2,3,4,5,6')
    assert.equal(result.length, MAX_COMPARE)
    assert.deepEqual(result, [2, 1, 3, 4, 5])
  })
})
