import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSpeed } from '../../app/utils/misc.ts'

for (const [speed, expected] of [
  [0, '0 B/s'],
  [-5, '0 B/s'],
  [Number.NaN, '0 B/s'],
  [Number.POSITIVE_INFINITY, '0 B/s'],
  [Number.NEGATIVE_INFINITY, '0 B/s'],
  [0.4, '0 B/s'],
  [1023.49, '1023 B/s'],
  [1023.5, '1.0 KB/s'],
  [1023.6, '1.0 KB/s'],
  [1024, '1.0 KB/s'],
  [1024 * 1023.949, '1023.9 KB/s'],
  [1024 * 1023.95, '1.0 MB/s'],
  [1024 * 1024 - 1, '1.0 MB/s'],
  [1024 * 1024, '1.0 MB/s'],
  [1024 * 1024 * 2.5, '2.5 MB/s'],
] as const) {
  test(`formatSpeed(${speed}) = ${expected}`, () => {
    assert.equal(formatSpeed(speed), expected)
  })
}
