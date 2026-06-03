/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  URL: Env.schema.string(),
  LOG_LEVEL: Env.schema.string(),
  INTERNET_STATUS_TEST_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring storage paths
  |----------------------------------------------------------
  */
  NOMAD_STORAGE_PATH: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  //SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring the database package
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),
  DB_SSL: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the Redis connection
  |----------------------------------------------------------
  */
  REDIS_HOST: Env.schema.string({ format: 'host' }),
  REDIS_PORT: Env.schema.number(),

  /*
  |----------------------------------------------------------
  | Variables for configuring Project Nomad's external API URL
  |----------------------------------------------------------
  */
  NOMAD_API_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring a native (non-Docker) Ollama instance
  | When set, the app connects to this URL instead of managing
  | an Ollama Docker container. Useful on macOS where native
  | Ollama can use Metal GPU acceleration.
  | Example: http://host.docker.internal:11434
  | (oMLX backend uses :11436; the macOS installer sets it per backend.)
  |----------------------------------------------------------
  */
  OLLAMA_HOST: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Which AI backend the host `nomad` CLI selected.
  | 'omlx'   = Apple MLX serves chat (Metal) + Ollama is the
  |            embeddings-only sidecar.
  | 'ollama' = native Homebrew Ollama serves chat + embeddings.
  | Forwarded by compose from the --env-file. Optional so the
  | validator doesn't throw when absent; callers default to 'ollama'.
  |----------------------------------------------------------
  */
  NOMAD_AI_BACKEND: Env.schema.enum.optional(['omlx', 'ollama'] as const),

  /*
  |----------------------------------------------------------
  | Apple Silicon chip / GPU model overrides (macOS host).
  | Inside Docker, systeminformation cannot read the exact chip
  | name from the host. The macOS installer probes the host with
  | system_profiler SPHardwareDataType / SPDisplaysDataType and
  | passes the result here so leaderboard rows and system-info
  | UIs show real chip names ("Apple M3 Max") instead of generic
  | "Apple Silicon (16-core)" placeholders.
  | Example: APPLE_CHIP_MODEL=Apple M3 Max
  |          APPLE_GPU_MODEL=Apple M3 Max (40-core GPU)
  |----------------------------------------------------------
  */
  APPLE_CHIP_MODEL: Env.schema.string.optional(),
  APPLE_GPU_MODEL: Env.schema.string.optional(),
})
