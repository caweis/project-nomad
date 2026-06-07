import { test } from '@japa/runner'
import { cadRenderStrategy } from '../../util/cad_render_strategy.js'

// ─── Rendered strategies ─────────────────────────────────────────────────────

test.group('cadRenderStrategy — renderable extensions', () => {
  test('.f3d → f3d', ({ assert }) => {
    assert.equal(cadRenderStrategy('.f3d'), 'f3d')
  })

  test('.dxf → dxf', ({ assert }) => {
    assert.equal(cadRenderStrategy('.dxf'), 'dxf')
  })

  test('.scad → scad', ({ assert }) => {
    assert.equal(cadRenderStrategy('.scad'), 'scad')
  })
})

// ─── Icon-only extensions (no renderer available) ────────────────────────────

test.group('cadRenderStrategy — icon-only extensions', () => {
  test('.step → icon', ({ assert }) => {
    assert.equal(cadRenderStrategy('.step'), 'icon')
  })

  test('.stp → icon', ({ assert }) => {
    assert.equal(cadRenderStrategy('.stp'), 'icon')
  })

  test('.iges → icon', ({ assert }) => {
    assert.equal(cadRenderStrategy('.iges'), 'icon')
  })

  test('.dwg → icon', ({ assert }) => {
    assert.equal(cadRenderStrategy('.dwg'), 'icon')
  })

  test('unknown extension → icon', ({ assert }) => {
    assert.equal(cadRenderStrategy('.xyz'), 'icon')
    assert.equal(cadRenderStrategy('.unknown'), 'icon')
    assert.equal(cadRenderStrategy(''), 'icon')
  })
})

// ─── Case normalisation ───────────────────────────────────────────────────────

test.group('cadRenderStrategy — case normalisation', () => {
  test('.DXF (uppercase) → dxf', ({ assert }) => {
    assert.equal(cadRenderStrategy('.DXF'), 'dxf')
  })

  test('.F3D (uppercase) → f3d', ({ assert }) => {
    assert.equal(cadRenderStrategy('.F3D'), 'f3d')
  })

  test('.SCAD (uppercase) → scad', ({ assert }) => {
    assert.equal(cadRenderStrategy('.SCAD'), 'scad')
  })

  test('.Dxf (mixed case) → dxf', ({ assert }) => {
    assert.equal(cadRenderStrategy('.Dxf'), 'dxf')
  })

  test('extension without leading dot is normalised', ({ assert }) => {
    assert.equal(cadRenderStrategy('f3d'), 'f3d')
    assert.equal(cadRenderStrategy('dxf'), 'dxf')
    assert.equal(cadRenderStrategy('scad'), 'scad')
    assert.equal(cadRenderStrategy('step'), 'icon')
    assert.equal(cadRenderStrategy('dwg'), 'icon')
  })
})
