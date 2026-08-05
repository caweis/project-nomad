import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { BenchmarkType, DiskType } from '../../types/benchmark.js'

export default class BenchmarkResult extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare benchmark_id: string

  @column()
  declare benchmark_type: BenchmarkType

  // Hardware information
  @column()
  declare cpu_model: string

  @column()
  declare cpu_cores: number

  @column()
  declare cpu_threads: number

  @column()
  declare ram_bytes: number

  @column()
  declare disk_type: DiskType

  @column()
  declare gpu_model: string | null

  // System benchmark scores
  @column()
  declare cpu_score: number

  @column()
  declare memory_score: number

  @column()
  declare disk_read_score: number

  @column()
  declare disk_write_score: number

  // AI benchmark scores (nullable for system-only benchmarks)
  @column()
  declare ai_tokens_per_second: number | null

  @column()
  declare ai_model_used: string | null

  @column()
  declare ai_time_to_first_token: number | null

  // Composite NOMAD score (0-100)
  @column()
  declare nomad_score: number

  // Repository submission tracking
  @column({
    serialize(value) {
      return Boolean(value)
    },
  })
  declare submitted_to_repository: boolean

  @column.dateTime()
  declare submitted_at: DateTime | null

  @column()
  declare repository_id: string | null

  @column()
  declare builder_tag: string | null

  // Platform metadata (nullable — fork port of upstream #1158). Sourced from
  // the Docker daemon, not systeminformation: inside the admin container
  // si.osInfo()/os.arch() describe the container, not the host. On macOS
  // engines os_name/os_version describe the container VM (e.g. 'OrbStack'),
  // not macOS — see BenchmarkService._detectPlatformMetadata.
  @column()
  declare cpu_architecture: string | null

  @column()
  declare os_name: string | null

  @column()
  declare os_version: string | null

  // Fork-specific: which engine/VM ran the benchmark ('orbstack',
  // 'docker-desktop', 'colima', 'lima'; null when unproven).
  @column()
  declare container_engine: string | null

  // Fork-specific: 'native' (Node benchmarks, macOS path) or 'sysbench'
  // (Linux container fallback). Scores are only comparable within a flavor.
  @column()
  declare benchmark_flavor: string | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime
}
