import { test } from '@japa/runner'
import axios from 'axios'
import { ZimService } from '#services/zim_service'

test('remote Kiwix rows retain details needed by the expandable catalog', async ({ assert }) => {
  const originalGet = axios.get
  ;(axios as any).get = async () => ({
    data: `<feed><totalResults>1</totalResults><entry>
      <id>book-1</id><title>Field Guide</title><summary>Long guide</summary>
      <updated>2026-10-01</updated><language>eng</language><category>science</category>
      <tags>offline;guide</tags><articleCount>120</articleCount><mediaCount>7</mediaCount>
      <author><name>Author</name></author><publisher><name>Publisher</name></publisher>
      <dc:issued>2026-09-15</dc:issued>
      <link rel="acquisition" type="application/x-zim" length="2048" href="https://download.kiwix.org/zim/field_guide.zim.meta4"/>
    </entry></feed>`,
  })
  try {
    const service = new ZimService({} as any)
    ;(service as any).list = async () => ({ files: [] })
    const response = await service.listRemote({ start: 0, count: 12 })
    assert.equal(response.items.length, 1)
    assert.deepInclude(response.items[0], {
      title: 'Field Guide',
      language: 'eng',
      category: 'science',
      tags: 'offline;guide',
      article_count: 120,
      media_count: 7,
      publisher: 'Publisher',
      issued: '2026-09-15',
      file_name: 'field_guide.zim',
    })
  } finally {
    ;(axios as any).get = originalGet
  }
})
