import { test } from '@japa/runner'
import { resourceMappingValid } from '#validators/inventory'

test.group('inventory · resourceMappingValid', () => {
  test('mapped resource with a positive contribution is valid', ({ assert }) => {
    const r = resourceMappingValid('water', 200)
    assert.isTrue(r.ok)
  })

  test('mapped resource with a null contribution is invalid', ({ assert }) => {
    const r = resourceMappingValid('food', null)
    assert.isFalse(r.ok)
    if (!r.ok) assert.match(r.error, /required when resource_type is set/)
  })

  test('mapped resource with an undefined contribution is invalid', ({ assert }) => {
    const r = resourceMappingValid('power', undefined)
    assert.isFalse(r.ok)
  })

  test('mapped resource with a zero contribution is invalid', ({ assert }) => {
    const r = resourceMappingValid('water', 0)
    assert.isFalse(r.ok)
    if (!r.ok) assert.match(r.error, /greater than 0/)
  })

  test('mapped resource with a negative contribution is invalid', ({ assert }) => {
    const r = resourceMappingValid('water', -5)
    assert.isFalse(r.ok)
  })

  test('unmapped item (undefined type) with no contribution is valid', ({ assert }) => {
    const r = resourceMappingValid(undefined, undefined)
    assert.isTrue(r.ok)
  })

  test('unmapped item (null type) with no contribution is valid', ({ assert }) => {
    const r = resourceMappingValid(null, null)
    assert.isTrue(r.ok)
  })

  test('explicit null type WITH a positive contribution is contradictory', ({ assert }) => {
    const r = resourceMappingValid(null, 50)
    assert.isFalse(r.ok)
    if (!r.ok) assert.match(r.error, /must be empty/)
  })

  test('undefined type with a stray contribution is permissive (partial update)', ({ assert }) => {
    // resource_type absent from a partial update payload — don't reject on a
    // contribution the controller will pair against the existing row's type.
    const r = resourceMappingValid(undefined, 50)
    assert.isTrue(r.ok)
  })
})
