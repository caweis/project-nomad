import { test } from '@japa/runner'
import { OllamaService } from '#services/ollama_service'
import { FALLBACK_RECOMMENDED_OLLAMA_MODELS } from '../../constants/ollama.js'
import env from '#start/env'
import { readFile } from 'node:fs/promises'

const model = (name: string, pulls: unknown) => ({
  id: name,
  name,
  estimated_pulls: pulls,
  tags: [{ name: '1b' }],
})

test.group('model catalog without popularity', (group) => {
  group.teardown(async () => {
    const { default: config } = await import('#config/queue')
    config.connection.disconnect()
  })
  test('browsing keeps all models and sorts missing/invalid counts last', async ({ assert }) => {
    const service = new OllamaService() as any
    const models = [
      model('zeta', null),
      model('alpha', undefined),
      model('valid', '1.2M'),
      model('broken', 'no'),
    ]
    service.retrieveAndRefreshModels = async () => service.sortModels(models, 'pulls')
    const result = await service.getAvailableModels({ sort: 'pulls', query: null, limit: 20 })
    assert.deepEqual(
      result.models.map((m: any) => m.name),
      ['valid', 'alpha', 'broken', 'zeta']
    )
  })
  test('recommendations use curated models when the catalog has no counts', async ({ assert }) => {
    const service = new OllamaService() as any
    service.retrieveAndRefreshModels = async () => [model('unknown', null)]
    const result = await service.getAvailableModels({
      sort: 'pulls',
      recommendedOnly: true,
      query: null,
    })
    assert.deepEqual(
      new Set(result.models.map((m: any) => m.name)),
      new Set(FALLBACK_RECOMMENDED_OLLAMA_MODELS.slice(0, 3).map((m) => m.name))
    )
  })
  test('curated recommendations retain Apple MLX pull names', async ({ assert }) => {
    const original = env.get.bind(env)
    ;(env as any).get = (key: any, _fallback?: any) =>
      key === 'NOMAD_AI_BACKEND' ? 'omlx' : original(key)
    try {
      const service = new OllamaService() as any
      const mapping = JSON.parse(
        await readFile(
          new URL('../../../install/macos/omlx-proxy/config/model_map.json', import.meta.url),
          'utf8'
        )
      )
      service.fetchMlxPullableKeys = async () =>
        Object.keys(mapping).filter((key) => !key.startsWith('_'))
      service.retrieveAndRefreshModels = async () => [model('unknown', null)]
      const result = await service.getAvailableModels({
        sort: 'pulls',
        recommendedOnly: true,
        query: null,
      })
      const llama = result.models.find((m: any) => m.name === 'llama3.1')
      assert.equal(llama?.mlxPullName, 'llama3.1:8b')
    } finally {
      env.get = original
    }
  })
})
