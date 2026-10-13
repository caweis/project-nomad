import { test } from '@japa/runner'
import KbIngestState from '#models/kb_ingest_state'
import { RagService } from '#services/rag_service'

type DeleteCall = { collection: string; filter: unknown }

function fakeService(deleteCall: (call: DeleteCall) => Promise<void>) {
  const service = new RagService({} as never, {} as never)
  ;(service as any)._ensureCollection = async () => {}
  ;(service as any).qdrant = {
    delete: async (collection: string, options: { filter: unknown }) => {
      await deleteCall({ collection, filter: options.filter })
    },
  }
  return service
}

test.group('knowledge-base orphan batch', () => {
  test('deletes state first and then sends one match.any filter', async ({ assert }) => {
    const sources = ['/kb/a.pdf', '/kb/b.pdf']
    const events: string[] = []
    const originalQuery = KbIngestState.query
    ;(KbIngestState as any).query = () => ({
      whereIn: (column: string, values: string[]) => {
        assert.equal(column, 'file_path')
        assert.deepEqual(values, sources)
        return {
          delete: async () => {
            events.push('state')
          },
        }
      },
    })
    const service = fakeService(async ({ collection, filter }) => {
      events.push('qdrant')
      assert.equal(collection, RagService.CONTENT_COLLECTION_NAME)
      assert.deepEqual(filter, { must: [{ key: 'source', match: { any: sources } }] })
    })

    try {
      assert.equal(await service.purgeOrphanedSources(sources), 2)
      assert.deepEqual(events, ['state', 'qdrant'])
    } finally {
      ;(KbIngestState as any).query = originalQuery
    }
  })

  test('retries vector deletion after a Qdrant failure', async ({ assert }) => {
    const sources = ['/kb/a.pdf', '/kb/b.pdf']
    let stateDeletes = 0
    let vectorDeletes = 0
    const originalQuery = KbIngestState.query
    ;(KbIngestState as any).query = () => ({
      whereIn: () => ({
        delete: async () => {
          stateDeletes++
        },
      }),
    })
    const service = fakeService(async () => {
      vectorDeletes++
      if (vectorDeletes === 1) throw new Error('Qdrant unavailable')
    })

    try {
      assert.equal(await service.purgeOrphanedSources(sources), 0)
      assert.equal(await service.purgeOrphanedSources(sources), 2)
      assert.equal(stateDeletes, 2)
      assert.equal(vectorDeletes, 2)
    } finally {
      ;(KbIngestState as any).query = originalQuery
    }
  })

  test('does not delete vectors if the state query fails', async ({ assert }) => {
    const originalQuery = KbIngestState.query
    ;(KbIngestState as any).query = () => ({
      whereIn: () => ({
        delete: async () => {
          throw new Error('database unavailable')
        },
      }),
    })
    let vectorDeletes = 0
    const service = fakeService(async () => {
      vectorDeletes++
    })

    try {
      assert.equal(await service.purgeOrphanedSources(['/kb/a.pdf']), 0)
      assert.equal(vectorDeletes, 0)
    } finally {
      ;(KbIngestState as any).query = originalQuery
    }
  })

  test('an empty batch makes no database or Qdrant call', async ({ assert }) => {
    const originalQuery = KbIngestState.query
    ;(KbIngestState as any).query = () => {
      throw new Error('database should not be called')
    }
    const service = fakeService(async () => {
      throw new Error('Qdrant should not be called')
    })
    ;(service as any)._ensureCollection = async () => {
      throw new Error('collection setup should not be called')
    }

    try {
      assert.equal(await service.purgeOrphanedSources([]), 0)
    } finally {
      ;(KbIngestState as any).query = originalQuery
    }
  })

  test('the single-source entry point uses the same batch path', async ({ assert }) => {
    let count = 0
    const service = fakeService(async () => {})
    service.purgeOrphanedSources = async (sources) => {
      assert.deepEqual(sources, ['/kb/a.pdf'])
      count++
      return 1
    }
    await service.purgeOrphanedSource('/kb/a.pdf')
    assert.equal(count, 1)
  })
})
