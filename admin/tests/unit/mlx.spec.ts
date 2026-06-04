import { test } from '@japa/runner'
import { resolveMlxPullName, withMlxPullNames, parsePullableSizeB } from '../../util/mlx.js'

/**
 * Representative slice of the oMLX proxy's pullable set (the model_map.json
 * keys returned by GET /api/nomad/pullable). Mirrors the real curated map:
 * single-size families (llama3.1), multi-size families (gemma3, qwen2.5-coder),
 * large-only families (deepseek-r1), and the embedding keys (no ':' tag).
 */
const KEYS = [
  'llama3.1:8b',
  'llama3.2:1b',
  'llama3.2:3b',
  'llama3.3:70b',
  'gemma3:1b',
  'gemma3:4b',
  'gemma3:12b',
  'gemma3:27b',
  'qwen2.5-coder:7b',
  'qwen2.5-coder:14b',
  'qwen2.5-coder:32b',
  'deepseek-r1:32b',
  'deepseek-r1:70b',
  'nomic-embed-text',
  'mxbai-embed-large',
]

test.group('resolveMlxPullName', () => {
  test('single-size family resolves to its one key', ({ assert }) => {
    assert.equal(resolveMlxPullName('llama3.1', KEYS), 'llama3.1:8b')
  })

  test('multi-size family resolves to the SMALLEST pullable variant', ({ assert }) => {
    assert.equal(resolveMlxPullName('gemma3', KEYS), 'gemma3:1b')
    assert.equal(resolveMlxPullName('qwen2.5-coder', KEYS), 'qwen2.5-coder:7b')
  })

  test('large-only family still resolves (smallest of the large builds)', ({ assert }) => {
    // deepseek-r1 has no small MLX build; the catalog shows a 1.5b tag, but the
    // only pullable MLX sizes are 32b/70b — so "available" must map to 32b, the
    // smallest one that actually exists. This is the case the family-match
    // boolean got wrong (showed available, then refused at download).
    assert.equal(resolveMlxPullName('deepseek-r1', KEYS), 'deepseek-r1:32b')
  })

  test('family with no MLX conversion returns undefined', ({ assert }) => {
    assert.isUndefined(resolveMlxPullName('gemma4', KEYS))
    assert.isUndefined(resolveMlxPullName('phi4', KEYS))
  })

  test('matches the whole family, never a prefix', ({ assert }) => {
    // "llama3" must NOT match "llama3.1:8b" — the family is the entire base
    // name (substring before the first ':'), not a prefix.
    assert.isUndefined(resolveMlxPullName('llama3', KEYS))
  })
})

test.group('parsePullableSizeB', () => {
  test('parses parameter billions from the tag portion', ({ assert }) => {
    assert.equal(parsePullableSizeB('llama3.2:1b'), 1)
    assert.equal(parsePullableSizeB('qwen2.5:72b'), 72)
    assert.equal(parsePullableSizeB('mistral-small:24b'), 24)
    assert.equal(parsePullableSizeB('qwen2.5:1.5b'), 1.5)
  })

  test('size-less / embedding keys sort last (Infinity)', ({ assert }) => {
    assert.equal(parsePullableSizeB('nomic-embed-text'), Number.POSITIVE_INFINITY)
  })
})

test.group('withMlxPullNames', () => {
  test('annotates matching models and leaves unmatched untouched', ({ assert }) => {
    const models = [
      { name: 'llama3.1', tags: [] },
      { name: 'gemma4', tags: [] },
    ] as any
    const out = withMlxPullNames(models, KEYS)
    assert.equal(out[0].mlxPullName, 'llama3.1:8b')
    assert.isUndefined(out[1].mlxPullName)
  })

  test('is immutable — does not mutate the input models', ({ assert }) => {
    const models = [{ name: 'llama3.1', tags: [] }] as any
    const out = withMlxPullNames(models, KEYS)
    assert.notProperty(models[0], 'mlxPullName')
    assert.equal(out[0].mlxPullName, 'llama3.1:8b')
  })
})
