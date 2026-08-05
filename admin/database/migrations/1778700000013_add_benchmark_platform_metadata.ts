import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Platform metadata for benchmark results (fork port of upstream #1158).
 *
 * Upstream's three columns (cpu_architecture / os_name / os_version) plus two
 * fork-specific ones:
 *
 * - container_engine: which engine/VM ran the benchmark ('orbstack',
 *   'docker-desktop', 'colima', 'lima'; null when no marker proves one) — the
 *   macOS analog of upstream's WSL2-vs-native run_environment.
 * - benchmark_flavor: 'native' (Node benchmarks, the macOS path) or 'sysbench'
 *   (the Linux container fallback). The two flavors normalize against
 *   different reference scores, so raw scores are only comparable within a
 *   flavor — a result row must say which one produced it.
 *
 * All sourced from the Docker daemon rather than systeminformation, because
 * si.osInfo()/os.arch() inside the admin container describe the CONTAINER,
 * not the host. On macOS engines os_name/os_version describe the container
 * VM (e.g. 'OrbStack'), not macOS — see BenchmarkService._detectPlatformMetadata.
 * Nullable — pre-existing rows simply leave them empty.
 */
export default class extends BaseSchema {
  protected tableName = 'benchmark_results'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('cpu_architecture').nullable()
      table.string('os_name').nullable()
      table.string('os_version').nullable()
      table.string('container_engine').nullable()
      table.string('benchmark_flavor').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('cpu_architecture')
      table.dropColumn('os_name')
      table.dropColumn('os_version')
      table.dropColumn('container_engine')
      table.dropColumn('benchmark_flavor')
    })
  }
}
