import { test } from '@japa/runner'
import { RagService } from '../../app/services/rag_service.js'

test.group('RagService relevance floor', () => {
  test('filters after reranking and before source diversity', async ({ assert }) => {
    const service = new RagService(
      {} as any,
      {
        getClient: async () => ({ embed: async () => ({ embeddings: [[1, 0]] }) }),
      } as any
    )
    ;(service as any)._ensureCollection = async () => undefined
    ;(service as any).embeddingModelVerified = true
    ;(service as any).qdrant = {
      getCollection: async () => ({ points_count: 2 }),
      search: async () => [
        { score: 0.55, payload: { text: 'water guide', source: '/a' } },
        { score: 0.54, payload: { text: 'another guide', source: '/b' } },
      ],
    }
    ;(service as any).rerankResults = (rows: any[]) =>
      rows.map((row, index) => ({
        ...row,
        finalScore: index === 0 ? 0.7 : 0.61,
      }))
    let diversityInput: any[] = []
    ;(service as any).applySourceDiversity = (rows: any[]) => {
      diversityInput = rows
      return rows
    }

    const kept = await service.searchSimilarDocuments('water', 5, 0.3, undefined, 0.62)
    assert.equal(kept.length, 1)
    assert.equal(kept[0].metadata?.source, '/a')
    assert.equal(diversityInput.length, 1)
    assert.deepEqual(await service.searchSimilarDocuments('water', 5, 0.3, undefined, 0.9), [])
  })
})
