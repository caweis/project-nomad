import { test } from '@japa/runner'
import { ZimService } from '#services/zim_service'
import WikipediaSelection from '#models/wikipedia_selection'

test.group('Wikipedia mirror download completion', () => {
  test('matches a selected Wikipedia file by name when its mirror URL differs', async ({
    assert,
  }) => {
    const service = new ZimService({} as any)
    let saved = false
    const selection = {
      option_id: 'simple',
      url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_simple_2026-10.zim',
      filename: 'wikipedia_en_simple_2026-10.zim',
      status: 'downloading',
      save: async () => {
        saved = true
      },
    }
    ;(service as any).getWikipediaSelection = async () => selection
    ;(service as any).getWikipediaOptions = async () => [
      {
        id: 'simple',
        url: selection.url,
      },
    ]
    ;(service as any).list = async () => ({ files: [{ name: selection.filename }] })
    ;(service as any).delete = async () => {
      throw new Error('No prior version should be deleted')
    }

    const mirrorUrl = 'https://mirror.example.org/zim/wikipedia/wikipedia_en_simple_2026-10.zim'
    await service.onWikipediaDownloadComplete(mirrorUrl, true)

    assert.isTrue(saved)
    assert.equal(selection.status, 'installed')
    assert.equal(selection.url, mirrorUrl)
    assert.equal(selection.option_id, 'simple')
  })

  test('does not replace a different Wikipedia selection that is still downloading', async ({
    assert,
  }) => {
    const service = new ZimService({} as any)
    let saved = false
    const selection = {
      option_id: 'full',
      url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_2026-10.zim',
      filename: 'wikipedia_en_all_2026-10.zim',
      status: 'downloading',
      save: async () => {
        saved = true
      },
    }
    ;(service as any).getWikipediaSelection = async () => selection
    ;(service as any).getWikipediaOptions = async () => []
    ;(service as any).list = async () => ({ files: [] })

    await service.onWikipediaDownloadComplete(
      'https://mirror.example.org/zim/wikipedia/wikipedia_en_simple_2026-10.zim',
      true
    )

    assert.isFalse(saved)
    assert.equal(selection.status, 'downloading')
    assert.equal(selection.option_id, 'full')
  })

  test('records a recognized Wikipedia file downloaded before a selection exists', async ({
    assert,
  }) => {
    const originalCreate = WikipediaSelection.create
    const created: Record<string, unknown>[] = []
    ;(WikipediaSelection as any).create = async (values: Record<string, unknown>) => {
      created.push(values)
      return values
    }
    try {
      const service = new ZimService({} as any)
      ;(service as any).getWikipediaSelection = async () => null
      ;(service as any).getWikipediaOptions = async () => [
        {
          id: 'simple',
          url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_simple_2026-10.zim',
        },
      ]
      ;(service as any).list = async () => ({ files: [] })
      await service.onWikipediaDownloadComplete(
        'https://mirror.example.org/zim/wikipedia/wikipedia_en_simple_2026-10.zim',
        true
      )
      assert.equal(created[0]?.option_id, 'simple')
      assert.equal(created[0]?.status, 'installed')
    } finally {
      ;(WikipediaSelection as any).create = originalCreate
    }
  })
})
