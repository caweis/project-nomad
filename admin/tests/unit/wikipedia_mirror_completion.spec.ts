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

  for (const hasSelection of [true, false]) {
    for (const catalogAvailable of [true, false]) {
      test(`does not adopt a medicine ZIM (selection=${hasSelection}, catalog=${catalogAvailable})`, async ({
        assert,
      }) => {
        const originalCreate = WikipediaSelection.create
        let created = false
        let saved = false
        let listed = false
        const selection = {
          option_id: 'all-mini',
          url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-06.zim',
          filename: 'wikipedia_en_all_mini_2026-06.zim',
          status: 'installed',
          save: async () => {
            saved = true
          },
        }
        ;(WikipediaSelection as any).create = async () => {
          created = true
        }
        try {
          const service = new ZimService({} as any)
          ;(service as any).getWikipediaSelection = async () => (hasSelection ? selection : null)
          ;(service as any).getWikipediaOptions = async () => {
            if (!catalogAvailable) throw new Error('Catalog unavailable')
            return [{ id: 'all-mini', url: selection.url }]
          }
          ;(service as any).list = async () => {
            listed = true
            return { files: [] }
          }

          await service.onWikipediaDownloadComplete(
            'https://mirror.example.org/zim/wikipedia_en_medicine_maxi_2026-09.zim',
            true
          )

          assert.isFalse(created)
          assert.isFalse(saved)
          assert.isFalse(listed)
          assert.equal(selection.option_id, 'all-mini')
          assert.equal(selection.filename, 'wikipedia_en_all_mini_2026-06.zim')
          assert.equal(selection.status, 'installed')
        } finally {
          ;(WikipediaSelection as any).create = originalCreate
        }
      })
    }
  }

  for (const success of [true, false]) {
    test(`updates the selected custom filename on ${success ? 'success' : 'failure'}`, async ({
      assert,
    }) => {
      const service = new ZimService({} as any)
      let saved = false
      const selection = {
        option_id: 'all-mini',
        url: 'https://mirror.example.org/zim/preferred-wikipedia.zim',
        filename: 'preferred-wikipedia.zim',
        status: 'downloading',
        save: async () => {
          saved = true
        },
      }
      ;(service as any).getWikipediaSelection = async () => selection
      ;(service as any).getWikipediaOptions = async () => {
        throw new Error('Catalog unavailable')
      }
      ;(service as any).list = async () => ({ files: [{ name: selection.filename }] })

      await service.onWikipediaDownloadComplete(selection.url, success)

      assert.isTrue(saved)
      assert.equal(selection.option_id, 'all-mini')
      assert.equal(selection.status, success ? 'installed' : 'failed')
    })
  }
})
