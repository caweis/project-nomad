import { test } from '@japa/runner'
import { requiredFieldsPresent } from '../../util/workshop_batch.js'

test.group('requiredFieldsPresent — update-metadata', () => {
  test('ok when only material supplied', ({ assert }) => {
    assert.deepEqual(requiredFieldsPresent('update-metadata', { material: 'PLA' }), { ok: true })
  })

  test('ok when only difficulty supplied', ({ assert }) => {
    assert.deepEqual(requiredFieldsPresent('update-metadata', { difficulty: 'beginner' }), {
      ok: true,
    })
  })

  test('ok when both supplied', ({ assert }) => {
    assert.isTrue(
      requiredFieldsPresent('update-metadata', { material: 'PETG', difficulty: 'advanced' }).ok
    )
  })

  test('ok when material is explicitly null (clear it)', ({ assert }) => {
    // null is a deliberate "clear this field" — still counts as supplied.
    assert.isTrue(requiredFieldsPresent('update-metadata', { material: null }).ok)
  })

  test('ok when difficulty is explicitly null (clear it)', ({ assert }) => {
    assert.isTrue(requiredFieldsPresent('update-metadata', { difficulty: null }).ok)
  })

  test('fails when neither supplied', ({ assert }) => {
    const r = requiredFieldsPresent('update-metadata', {})
    assert.isFalse(r.ok)
    assert.match(r.error!, /material|difficulty/)
  })

  test('a stray category does not satisfy update-metadata', ({ assert }) => {
    const r = requiredFieldsPresent('update-metadata', { category: 'tools' })
    assert.isFalse(r.ok)
  })
})

test.group('requiredFieldsPresent — recategorize', () => {
  test('ok when category supplied', ({ assert }) => {
    assert.deepEqual(requiredFieldsPresent('recategorize', { category: 'medical' }), { ok: true })
  })

  test('fails when category missing', ({ assert }) => {
    const r = requiredFieldsPresent('recategorize', {})
    assert.isFalse(r.ok)
    assert.match(r.error!, /category/)
  })

  test('material/difficulty do not satisfy recategorize', ({ assert }) => {
    const r = requiredFieldsPresent('recategorize', { material: 'PLA', difficulty: 'beginner' })
    assert.isFalse(r.ok)
  })
})

test.group('requiredFieldsPresent — delete', () => {
  test('ok with no fields', ({ assert }) => {
    assert.deepEqual(requiredFieldsPresent('delete', {}), { ok: true })
  })

  test('ok even if fields are present (ignored)', ({ assert }) => {
    assert.isTrue(requiredFieldsPresent('delete', { category: 'tools', material: 'PLA' }).ok)
  })
})
