import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
  default: 'app',

  /**
   * The loggers object can be used to define multiple loggers.
   * By default, we configure only one logger (named "app").
   */
  loggers: {
    app: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: env.get('NODE_ENV') === 'production' ? env.get('LOG_LEVEL') : 'debug', // default to 'debug' in non-production envs
      transport: {
        targets:
          targets()
            .pushIf(!app.inProduction, targets.pretty())
            // Production: write JSON to both the persisted log file (Debug Info
            // bundle export reads it) AND stdout (destination 1), so
            // `docker logs nomad_admin` / `nomad_admin_worker` and any external
            // log aggregator can see runtime telemetry — RAG batch progress,
            // embed dispatch lines, query rewrites. Without the stdout target a
            // prod install is blind from outside the container.
            .pushIf(app.inProduction, targets.file({ destination: "/app/storage/logs/admin.log" }))
            .pushIf(app.inProduction, targets.file({ destination: 1 }))
            .toArray(),
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> { }
}
