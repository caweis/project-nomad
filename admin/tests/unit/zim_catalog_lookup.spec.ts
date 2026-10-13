import { test } from '@japa/runner'
import axios from 'axios'
import { ZimService } from '#services/zim_service'

function feed(...filenames: string[]): string {
  return `<feed>${filenames
    .map(
      (name) =>
        `<entry><id>${name}</id><title>${name}</title><summary>Book</summary><link rel="acquisition" type="application/x-zim" href="https://download.kiwix.org/zim/${name}.meta4"/></entry>`
    )
    .join('')}</feed>`
}

test('curated ZIM lookup retries the base name and keeps the requested flavour', async ({
  assert,
}) => {
  const originalGet = axios.get
  const requests: string[] = []
  ;(axios as any).get = async (_url: string, options: any) => {
    const name = options.params.name
    requests.push(name)
    if (name === 'wikipedia_en_medicine_maxi') return { data: feed() }
    if (name === 'wikipedia_en_medicine') {
      return {
        data: feed(
          'wikipedia_en_medicine_mini_2026-09.zim',
          'wikipedia_en_medicine_maxi_2026-07.zim',
          'wikipedia_en_medicine_maxi_2026-08.zim'
        ),
      }
    }
    throw new Error(`Unexpected catalog lookup: ${name}`)
  }

  try {
    const service = new ZimService({} as any)
    const entries = await (service as any).getLatestCatalogEntries(['wikipedia_en_medicine_maxi'])
    assert.deepEqual(requests, ['wikipedia_en_medicine_maxi', 'wikipedia_en_medicine'])
    assert.deepEqual(entries.get('wikipedia_en_medicine_maxi'), {
      version: '2026-08',
      download_url: 'https://download.kiwix.org/zim/wikipedia_en_medicine_maxi_2026-08.zim',
    })
  } finally {
    ;(axios as any).get = originalGet
  }
})

test('curated ZIM lookup selects the newest matching entry from the exact-name feed', async ({
  assert,
}) => {
  const originalGet = axios.get
  const requests: string[] = []
  ;(axios as any).get = async (_url: string, options: any) => {
    requests.push(options.params.name)
    return {
      data: feed(
        'wikibooks_en_all_mini_2026-10.zim',
        'wikibooks_en_all_maxi_2026-07.zim',
        'wikibooks_en_all_maxi_2026-09.zim'
      ),
    }
  }

  try {
    const service = new ZimService({} as any)
    const entries = await (service as any).getLatestCatalogEntries(['wikibooks_en_all_maxi'])
    assert.deepEqual(requests, ['wikibooks_en_all_maxi'])
    assert.deepEqual(entries.get('wikibooks_en_all_maxi'), {
      version: '2026-09',
      download_url: 'https://download.kiwix.org/zim/wikibooks_en_all_maxi_2026-09.zim',
    })
  } finally {
    ;(axios as any).get = originalGet
  }
})
