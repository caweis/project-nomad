import { test } from '@japa/runner'
import axios from 'axios'
import { BenchmarkService } from '#services/benchmark_service'
import { SystemService } from '#services/system_service'
import BenchmarkResult from '#models/benchmark_result'
import { SCORE_V2_REFERENCE } from '../../app/utils/score_v2.js'

test.group('Score v2 benchmark wiring', () => {
  test('uses the installer host platform before Docker Desktop heuristics', ({ assert }) => {
    const original = process.env.HOST_PLATFORM
    try {
      const service = new BenchmarkService({} as any)
      process.env.HOST_PLATFORM = 'darwin'
      assert.isTrue((service as any)._isMacOS())
      process.env.HOST_PLATFORM = 'linux'
      assert.isFalse((service as any)._isMacOS())
    } finally {
      if (original === undefined) delete process.env.HOST_PLATFORM
      else process.env.HOST_PLATFORM = original
    }
  })

  test('records six scored raw channels from the Linux workload', async ({ assert }) => {
    const service = new BenchmarkService({} as any)
    ;(service as any)._isMacOS = () => false
    ;(service as any)._ensureSysbenchImage = async () => undefined
    const threadCounts: number[] = []
    ;(service as any)._runSysbenchCpu = async (threads: number) => {
      threadCounts.push(threads)
      return {
        events_per_second: threads === 1 ? 2351 : 19231,
        total_time: 30,
        total_events: 576930,
      }
    }
    ;(service as any)._runSysbenchMemory = async () => ({ operations_per_second: 26862960 })
    ;(service as any)._runSysbenchDiskRead = async () => ({ read_mb_per_sec: 1072 })
    ;(service as any)._runSysbenchDiskWrite = async () => ({ write_mb_per_sec: 316 })
    ;(service as any)._updateStatus = () => undefined
    const run = await (service as any)._runSystemBenchmarks(16)
    assert.deepEqual(threadCounts, [1, 16])
    assert.deepInclude(run.raws, {
      cpu_events_single: 2351,
      cpu_events_multi: 19231,
      cpu_benchmark_threads: 16,
      memory_ops_per_sec: 26862960,
      disk_read_mb_per_sec: 1072,
      disk_write_mb_per_sec: 316,
    })
  })

  test('keeps the Mac native score path without inventing comparable raws', async ({ assert }) => {
    const service = new BenchmarkService({} as any)
    ;(service as any)._isMacOS = () => true
    ;(service as any)._runNativeBenchmarks = async () => ({
      cpu_score: 0.5,
      memory_score: 0.5,
      disk_read_score: 0.5,
      disk_write_score: 0.5,
    })
    const run = await (service as any)._runSystemBenchmarks(8)
    assert.isNull(run.raws)
    assert.equal(run.scores.cpu_score, 0.5)
  })

  test('stores Mac experimental v2 measurements separately from its legacy AI score', async ({
    assert,
  }) => {
    const originalCreate = BenchmarkResult.create
    let saved: Record<string, any> | undefined
    ;(BenchmarkResult as any).create = async (values: Record<string, any>) => {
      saved = values
      return values
    }
    try {
      const service = new BenchmarkService({} as any)
      ;(service as any)._isMacOS = () => true
      ;(service as any)._updateStatus = () => undefined
      ;(service as any).getHardwareInfo = async () => ({
        cpu_model: 'Apple M4',
        cpu_cores: 10,
        cpu_threads: 10,
        ram_bytes: 16 * 1024 ** 3,
        disk_type: 'ssd',
        gpu_model: 'Apple GPU',
      })
      ;(service as any)._detectPlatformMetadata = async () => ({
        cpu_architecture: 'arm64',
        os_name: 'macOS',
        os_version: '15',
        container_engine: 'OrbStack',
      })
      ;(service as any)._runSystemBenchmarks = async () => ({
        scores: { cpu_score: 0.5, memory_score: 0.5, disk_read_score: 0.5, disk_write_score: 0.5 },
        raws: null,
      })
      ;(service as any)._runAIBenchmark = async () => ({
        ai_tokens_per_second: 37,
        ai_model_used: 'llama3.2:1b',
        ai_time_to_first_token: 60,
      })
      ;(service as any)._runExperimentalMacScoreV2 = async () => ({
        raws: {
          ...SCORE_V2_REFERENCE,
          cpu_benchmark_threads: 10,
          cpu_total_events: 100,
          cpu_total_time: 30,
          memory_threads: 4,
        },
        scores: {
          ai_tokens_per_second: SCORE_V2_REFERENCE.ai_tokens_per_second,
          ai_model_used: 'llama3.1:8b',
          ai_time_to_first_token: 120,
        },
        ollamaVersion: '0.12.0',
      })
      ;(service as any)._resolveSysbenchDigest = async () => 'sha256:test'

      await service.runFullBenchmark()
      assert.equal(saved?.ai_tokens_per_second, 37)
      assert.equal(saved?.score_v2_ai_tokens_per_second, 13.2)
      assert.equal(saved?.nomad_score_v2, 1000)
      assert.equal(saved?.benchmark_flavor, 'native')
      assert.equal(saved?.run_environment, 'macos-vm')
      assert.equal(saved?.sysbench_digest, 'sha256:test')
    } finally {
      ;(BenchmarkResult as any).create = originalCreate
    }
  })

  test('keeps a Mac legacy result when experimental v2 cannot run', async ({ assert }) => {
    const originalCreate = BenchmarkResult.create
    let saved: Record<string, any> | undefined
    ;(BenchmarkResult as any).create = async (values: Record<string, any>) => {
      saved = values
      return values
    }
    try {
      const service = new BenchmarkService({} as any)
      ;(service as any)._isMacOS = () => true
      ;(service as any)._updateStatus = () => undefined
      ;(service as any).getHardwareInfo = async () => ({
        cpu_model: 'Apple M4',
        cpu_cores: 10,
        cpu_threads: 10,
        ram_bytes: 16 * 1024 ** 3,
        disk_type: 'ssd',
        gpu_model: 'Apple GPU',
      })
      ;(service as any)._detectPlatformMetadata = async () => ({
        cpu_architecture: 'arm64',
        os_name: 'macOS',
        os_version: '15',
        container_engine: 'OrbStack',
      })
      ;(service as any)._runSystemBenchmarks = async () => ({
        scores: { cpu_score: 0.5, memory_score: 0.5, disk_read_score: 0.5, disk_write_score: 0.5 },
        raws: null,
      })
      ;(service as any)._runAIBenchmark = async () => ({
        ai_tokens_per_second: 37,
        ai_model_used: 'llama3.2:1b',
        ai_time_to_first_token: 60,
      })
      ;(service as any)._runExperimentalMacScoreV2 = async () => {
        throw new Error('native Ollama unavailable')
      }

      await service.runFullBenchmark()
      assert.equal(saved?.ai_tokens_per_second, 37)
      assert.isAbove(saved?.nomad_score, 0)
      assert.isNull(saved?.nomad_score_v2)
      assert.isNull(saved?.score_v2_ai_tokens_per_second)
      assert.isNull(saved?.cpu_events_single)
    } finally {
      ;(BenchmarkResult as any).create = originalCreate
    }
  })

  test('routes Mac v2 through sysbench and the native Ollama daemon', async ({ assert }) => {
    const service = new BenchmarkService({} as any)
    const calls: string[] = []
    ;(service as any)._preflightModelDiskSpace = async (url: string) => {
      calls.push(`disk:${url}`)
    }
    ;(service as any)._runSysbenchBenchmarks = async (threads: number) => {
      calls.push(`sysbench:${threads}`)
      return { raws: { ...SCORE_V2_REFERENCE } }
    }
    ;(service as any)._runAIBenchmarkV2 = async (url: string) => {
      calls.push(`ai:${url}`)
      return {
        scores: {
          ai_tokens_per_second: 13.2,
          ai_model_used: 'llama3.1:8b',
          ai_time_to_first_token: 120,
        },
        ollamaVersion: '0.12.0',
      }
    }

    const measured = await (service as any)._runExperimentalMacScoreV2(10)
    assert.deepEqual(calls, [
      'disk:http://host.docker.internal:11434',
      'sysbench:10',
      'ai:http://host.docker.internal:11434',
    ])
    assert.equal(measured.raws.cpu_events_single, SCORE_V2_REFERENCE.cpu_events_single)
    assert.equal(measured.scores.ai_tokens_per_second, 13.2)
  })

  test('rejects invalid AI raw metrics instead of estimating Score v2', async ({ assert }) => {
    const originalPost = axios.post
    ;(axios as any).post = async () => ({ data: { eval_count: 0, eval_duration: 0 } })
    try {
      const service = new BenchmarkService({} as any)
      await assert.rejects(
        () => (service as any)._singleV2Inference('http://127.0.0.1'),
        /valid token/
      )
    } finally {
      ;(axios as any).post = originalPost
    }
  })

  test('does not submit a v2 result as a legacy v1 payload', async ({ assert }) => {
    const service = new BenchmarkService({} as any)
    ;(service as any).getResultById = async () => ({
      benchmark_type: 'full',
      ai_tokens_per_second: 13.2,
      submitted_to_repository: false,
      nomad_score_v2: 1000,
    })
    await assert.rejects(() => service.submitToRepository('example'), /sharing is not available/)
  })

  test('checks disk before pulling an uncached 8B model', async ({ assert }) => {
    const originalGet = axios.get
    const originalSystemInfo = SystemService.prototype.getSystemInfo
    let systemInfoCalls = 0
    ;(axios as any).get = async () => ({ data: { models: [] } })
    ;(SystemService.prototype as any).getSystemInfo = async () => {
      systemInfoCalls++
      return { fsSize: [{ mount: '/', available: 4 * 1024 ** 3 }] }
    }
    try {
      const service = new BenchmarkService({ getServiceURL: async () => 'http://127.0.0.1' } as any)
      await assert.rejects(
        () => (service as any)._preflightModelDiskSpace(),
        /Not enough free disk space/
      )
      assert.equal(systemInfoCalls, 1)
      ;(axios as any).get = async () => ({ data: { models: [{ name: 'llama3.1:8b' }] } })
      await (service as any)._preflightModelDiskSpace()
      assert.equal(systemInfoCalls, 1)
    } finally {
      ;(axios as any).get = originalGet
      SystemService.prototype.getSystemInfo = originalSystemInfo
    }
  })
})
