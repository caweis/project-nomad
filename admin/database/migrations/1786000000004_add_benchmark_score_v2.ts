import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'benchmark_results'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.double('cpu_events_single').nullable()
      table.double('cpu_events_multi').nullable()
      table.integer('cpu_benchmark_threads').nullable()
      table.double('cpu_total_events').nullable()
      table.double('cpu_total_time').nullable()
      table.double('memory_ops_per_sec').nullable()
      table.integer('memory_threads').nullable()
      table.double('disk_read_mb_per_sec').nullable()
      table.double('disk_write_mb_per_sec').nullable()
      table.double('nomad_score_v2').nullable()
      table.string('ollama_version').nullable()
      table.string('sysbench_digest').nullable()
      table.string('run_environment').nullable()
      table.string('storage_path_type').nullable()
      table.boolean('gpu_compute_detected').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      for (const key of [
        'cpu_events_single',
        'cpu_events_multi',
        'cpu_benchmark_threads',
        'cpu_total_events',
        'cpu_total_time',
        'memory_ops_per_sec',
        'memory_threads',
        'disk_read_mb_per_sec',
        'disk_write_mb_per_sec',
        'nomad_score_v2',
        'ollama_version',
        'sysbench_digest',
        'run_environment',
        'storage_path_type',
        'gpu_compute_detected',
      ])
        table.dropColumn(key)
    })
  }
}
