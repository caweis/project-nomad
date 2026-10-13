import env from '#start/env'
import { defineConfig } from '@adonisjs/transmit'
import { redis } from '@adonisjs/transmit/transports'

export default defineConfig({
  pingInterval: false,
  // The test runner uses one process. Starting a subscriber during boot races
  // its shutdown and leaves a rejected Redis command after the tests finish.
  transport:
    env.get('NODE_ENV') === 'test'
      ? null
      : {
          driver: redis({
            host: env.get('REDIS_HOST'),
            port: env.get('REDIS_PORT'),
            keyPrefix: 'transmit:',
          }),
        },
})
