import { test } from '@japa/runner'
import { resolveStepLink } from '../../util/scenario_links.js'

test.group('resolveStepLink — single link kinds', () => {
  test('inventory link resolves to /inventory/:id', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: 12, stl_file_id: null, zim_ref: null }), {
      kind: 'inventory',
      href: '/inventory/12',
    })
  })

  test('stl link resolves to /workshop/:id', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: null, stl_file_id: 7, zim_ref: null }), {
      kind: 'stl',
      href: '/workshop/7',
    })
  })

  test('zim link resolves to the stored ref verbatim', ({ assert }) => {
    const ref = 'http://nomad.local:8090/viewer#wikipedia/A/Power_outage'
    assert.deepEqual(resolveStepLink({ inventory_item_id: null, stl_file_id: null, zim_ref: ref }), {
      kind: 'zim',
      href: ref,
    })
  })

  test('an absolute-path zim ref is used as-is', ({ assert }) => {
    assert.deepEqual(
      resolveStepLink({ inventory_item_id: null, stl_file_id: null, zim_ref: '/viewer#wikipedia/A/Boil_water' }),
      { kind: 'zim', href: '/viewer#wikipedia/A/Boil_water' }
    )
  })
})

test.group('resolveStepLink — none', () => {
  test('no link fields set returns kind none, href null', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: null, stl_file_id: null, zim_ref: null }), {
      kind: 'none',
      href: null,
    })
  })

  test('undefined fields (omitted entirely) returns none', ({ assert }) => {
    assert.deepEqual(resolveStepLink({}), { kind: 'none', href: null })
  })

  test('empty-string zim_ref is treated as unset', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: null, stl_file_id: null, zim_ref: '' }), {
      kind: 'none',
      href: null,
    })
  })

  test('whitespace-only zim_ref is treated as unset', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: null, stl_file_id: null, zim_ref: '   ' }), {
      kind: 'none',
      href: null,
    })
  })

  test('a trimmable zim_ref is trimmed', ({ assert }) => {
    assert.deepEqual(
      resolveStepLink({ inventory_item_id: null, stl_file_id: null, zim_ref: '  /viewer#x  ' }),
      { kind: 'zim', href: '/viewer#x' }
    )
  })
})

test.group('resolveStepLink — precedence (inventory > stl > zim)', () => {
  test('inventory wins over stl and zim when all set', ({ assert }) => {
    assert.deepEqual(
      resolveStepLink({ inventory_item_id: 3, stl_file_id: 9, zim_ref: '/viewer#x' }),
      { kind: 'inventory', href: '/inventory/3' }
    )
  })

  test('inventory wins over stl', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: 3, stl_file_id: 9, zim_ref: null }), {
      kind: 'inventory',
      href: '/inventory/3',
    })
  })

  test('inventory wins over zim', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: 3, stl_file_id: null, zim_ref: '/viewer#x' }), {
      kind: 'inventory',
      href: '/inventory/3',
    })
  })

  test('stl wins over zim when inventory is null', ({ assert }) => {
    assert.deepEqual(resolveStepLink({ inventory_item_id: null, stl_file_id: 9, zim_ref: '/viewer#x' }), {
      kind: 'stl',
      href: '/workshop/9',
    })
  })
})

test.group('resolveStepLink — id edge cases', () => {
  test('inventory id 0 still resolves (0 is a valid distinct-from-null id)', ({ assert }) => {
    // 0 is never a real bigIncrements id, but the helper must not treat 0 as
    // "unset" — only null/undefined mean unset. Defensive against `0 || x` bugs.
    assert.deepEqual(resolveStepLink({ inventory_item_id: 0, stl_file_id: null, zim_ref: null }), {
      kind: 'inventory',
      href: '/inventory/0',
    })
  })
})
