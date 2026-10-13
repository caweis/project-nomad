import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import { Redis } from 'ioredis'

// BullMQ reuses this command connection across queues. Workers duplicate it
// for blocking operations; those extra clients are owned by BullMQ.
const sharedConnection = new Redis({
  host: env.get('REDIS_HOST'),
  port: env.get('REDIS_PORT') ?? 6379,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (attempts) => Math.min(attempts * 200, 2000),
})

sharedConnection.on('error', (error) => {
  logger.error({ err: error }, 'Shared Redis connection error')
})

const queueConfig = { connection: sharedConnection }

export default queueConfig
