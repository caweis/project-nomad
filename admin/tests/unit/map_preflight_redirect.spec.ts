import { test } from '@japa/runner'
import axios from 'axios'
import { MapService } from '#services/map_service'

test('map preflight rejects a redirect to a local service', async ({ assert }) => {
  const originalHead = axios.head
  let checkedRedirect = false
  ;(axios as any).head = async (_url: string, options: any) => {
    assert.equal(options.timeout, 30_000)
    assert.throws(() =>
      options.beforeRedirect({ protocol: 'http:', hostname: '127.0.0.1', port: 8080 })
    )
    checkedRedirect = true
    return { status: 200, headers: { 'content-length': '1024' } }
  }

  try {
    const result = await new MapService().downloadRemotePreflight(
      'https://maps.example/area.pmtiles'
    )
    assert.isTrue(checkedRedirect)
    assert.deepEqual(result, { filename: 'area.pmtiles', size: 1024 })
  } finally {
    ;(axios as any).head = originalHead
  }
})
