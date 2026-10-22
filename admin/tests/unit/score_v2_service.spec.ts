import { test } from '@japa/runner'
import axios from 'axios'
import { BenchmarkService } from '#services/benchmark_service'
import { SystemService } from '#services/system_service'

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
