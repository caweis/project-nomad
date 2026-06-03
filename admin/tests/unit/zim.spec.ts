import { test } from '@japa/runner'
import axios from 'axios'
import { classifyCatalogFetchError } from '../../util/zim.js'

/**
 * Helper to fabricate an Axios "upstream returned an error status" error, the
 * shape axios throws when the remote OPDS catalog responds non-2xx (e.g. 503).
 */
function httpError(status: number) {
  return new axios.AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    { status, statusText: '', data: '', headers: {}, config: {} } as any
  )
}

test.group('classifyCatalogFetchError', () => {
  test('classifies a network-level failure (no response) as unreachable', ({ assert }) => {
    // ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ETIMEDOUT all arrive with no response.
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']) {
      const reason = classifyCatalogFetchError(new axios.AxiosError('connect failed', code))
      assert.isNotNull(reason)
      assert.include(reason!, 'network unreachable')
      assert.include(reason!, code)
    }
  })

  test('classifies an upstream 503 as unavailable', ({ assert }) => {
    const reason = classifyCatalogFetchError(httpError(503))
    assert.equal(reason, 'upstream responded 503')
  })

  test('classifies any upstream HTTP error response (incl. 4xx) as unavailable', ({ assert }) => {
    assert.equal(classifyCatalogFetchError(httpError(429)), 'upstream responded 429')
    assert.equal(classifyCatalogFetchError(httpError(404)), 'upstream responded 404')
  })

  test('returns null for a genuine internal error so it keeps propagating', ({ assert }) => {
    // e.g. the malformed-XML guard in ZimService.listRemote throws a plain Error.
    assert.isNull(classifyCatalogFetchError(new Error('Invalid response format from remote library')))
  })

  test('returns null for non-error thrown values', ({ assert }) => {
    assert.isNull(classifyCatalogFetchError('boom'))
    assert.isNull(classifyCatalogFetchError(undefined))
    assert.isNull(classifyCatalogFetchError(null))
  })
})
