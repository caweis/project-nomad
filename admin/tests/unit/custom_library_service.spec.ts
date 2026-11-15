import { test } from '@japa/runner'
import nodeAssert from 'node:assert/strict'
import axios from 'axios'
import CustomLibrarySource from '#models/custom_library_source'
import { CustomLibraryError, ZimService } from '#services/zim_service'

test.group('custom Kiwix library service', () => {
  test('browses only within a saved source with bounded, nonredirecting fetches', async ({
    assert,
  }) => {
    const originalFind = CustomLibrarySource.find
    const originalGet = axios.get
    let fetched = false
    ;(CustomLibrarySource as any).find = async () => ({
      base_url: 'https://mirror.example.org/kiwix/zim/',
    })
    ;(axios as any).get = async (url: string, options: any) => {
      fetched = true
      assert.equal(url, 'https://mirror.example.org/kiwix/zim/wikipedia/')
      assert.equal(options.maxRedirects, 0)
      assert.equal(options.maxContentLength, 5 * 1024 * 1024)
      assert.equal(options.proxy, false)
      assert.isFunction(options.httpAgent.options.lookup)
      assert.isFunction(options.httpsAgent.options.lookup)
      return { data: '<a href="sample.zim">sample.zim</a>  1M' }
    }
    try {
      const service = new ZimService({} as any)
      const result = await service.browseCustomLibrary(1, 'wikipedia/')
      assert.isTrue(fetched)
      assert.equal(result.files[0].name, 'sample.zim')
      await nodeAssert.rejects(
        () => service.browseCustomLibrary(1, '../private/'),
        (error: unknown) => error instanceof CustomLibraryError && error.status === 400
      )
    } finally {
      ;(CustomLibrarySource as any).find = originalFind
      ;(axios as any).get = originalGet
    }
  })

  test('does not remove a built-in mirror', async ({ assert }) => {
    const originalFind = CustomLibrarySource.find
    let deleted = false
    ;(CustomLibrarySource as any).find = async () => ({
      is_default: true,
      delete: async () => {
        deleted = true
      },
    })
    try {
      const service = new ZimService({} as any)
      await nodeAssert.rejects(
        () => service.removeCustomLibrary(1),
        (error: unknown) => error instanceof CustomLibraryError && error.status === 403
      )
      assert.isFalse(deleted)
    } finally {
      ;(CustomLibrarySource as any).find = originalFind
    }
  })
})
