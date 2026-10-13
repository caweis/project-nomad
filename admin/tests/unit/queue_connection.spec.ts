import { test } from '@japa/runner'
import { Redis } from 'ioredis'
import queueConfig from '#config/queue'

test.group('BullMQ connection', () => {
  test('uses one lazy ioredis client with bounded reconnects', ({ assert }) => {
    const connection = queueConfig.connection
    assert.instanceOf(connection, Redis)
    assert.isTrue(connection.options.lazyConnect)
    assert.isNull(connection.options.maxRetriesPerRequest)
    assert.equal(connection.options.retryStrategy?.(1), 200)
    assert.equal(connection.options.retryStrategy?.(10), 2000)
    assert.equal(connection.options.retryStrategy?.(100), 2000)
    assert.isAbove(connection.listenerCount('error'), 0)
  })
})
