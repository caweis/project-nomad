import { test } from '@japa/runner'
import KbIngestState from '#models/kb_ingest_state'
import { RagService } from '#services/rag_service'

type StateRow = {
  file_path: string
  collection: string | null
  active: boolean
  save?: () => Promise<void>
}

class StateQuery {
  private filters: Array<(row: StateRow) => boolean> = []

  constructor(private rows: StateRow[]) {}

  where(key: keyof StateRow, value: unknown) {
    this.filters.push((row) => row[key] === value)
    return this
  }

  whereIn(key: keyof StateRow, values: string[]) {
    this.filters.push((row) => values.includes(String(row[key])))
    return this
  }

  async select(key: keyof StateRow) {
    return this.rows
      .filter((row) => this.filters.every((filter) => filter(row)))
      .map((row) => ({
        [key]: row[key],
      }))
  }

  count(_expression: string) {
    return this
  }

  async first() {
    return {
      $extras: {
        total: this.rows.filter((row) => this.filters.every((filter) => filter(row))).length,
      },
    }
  }

  async update(changes: Partial<StateRow>) {
    const matching = this.rows.filter((row) => this.filters.every((filter) => filter(row)))
    matching.forEach((row) => Object.assign(row, changes))
    return matching.length
  }
}

function serviceWithFailedQdrant() {
  const service = new RagService({} as never, {} as never)
  let calls = 0
  ;(service as any)._ensureCollection = async () => {}
  ;(service as any).qdrant = {
    setPayload: async () => {
      calls++
      throw new Error('Qdrant unavailable')
    },
  }
  return { service, calls: () => calls }
}

test.group('knowledge-base active toggles · Qdrant failure', () => {
  test('restores a file flag after a failed vector update', async ({ assert }) => {
    const row: StateRow = { file_path: '/kb/first-aid.pdf', collection: null, active: true }
    row.save = async () => {}
    const originalQuery = KbIngestState.query
    ;(KbIngestState as any).query = () => new StateQuery([row])
    const { service, calls } = serviceWithFailedQdrant()
    ;(service as any).ensureStateRowForSource = async () => row
    try {
      const result = await service.setFileActive(row.file_path, false)
      assert.isFalse(result.success)
      assert.equal(calls(), 1)
      assert.isTrue(row.active)
    } finally {
      ;(KbIngestState as any).query = originalQuery
    }
  })

  test('restores only changed collection rows after a failed vector update', async ({ assert }) => {
    const rows: StateRow[] = [
      { file_path: '/kb/one.pdf', collection: 'medical', active: true },
      { file_path: '/kb/two.pdf', collection: 'medical', active: false },
      { file_path: '/kb/three.pdf', collection: 'other', active: true },
    ]
    const originalQuery = KbIngestState.query
    ;(KbIngestState as any).query = () => new StateQuery(rows)
    const { service, calls } = serviceWithFailedQdrant()
    try {
      const result = await service.setKnowledgeCollectionActive('medical', false)
      assert.isFalse(result.success)
      assert.equal(calls(), 1)
      assert.deepEqual(
        rows.map((row) => row.active),
        [true, false, true]
      )
    } finally {
      ;(KbIngestState as any).query = originalQuery
    }
  })
})
