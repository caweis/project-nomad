import { test } from '@japa/runner'
import { SystemService } from '#services/system_service'
import { DockerService } from '#services/docker_service'
import si from 'systeminformation'

test.group('GPU fallback respects the inference backend', (group) => {
  group.teardown(async () => {
    const { default: queueConfig } = await import('#config/queue')
    queueConfig.connection.disconnect()
  })

  for (const scenario of [
    {
      name: 'Intel-only standard container is unsupported',
      vendors: ['Intel Corporation'],
      expected: 'unsupported',
    },
    {
      name: 'hybrid NVIDIA controller stays available',
      vendors: ['Intel Corporation', 'NVIDIA Corporation'],
      expected: 'ok',
    },
    {
      name: 'hybrid AMD controller stays available',
      vendors: ['Intel Corporation', 'Advanced Micro Devices, Inc.'],
      expected: 'ok',
    },
    {
      name: 'unknown vendor is not declared unsupported',
      vendors: ['Future Graphics'],
      expected: 'ok',
    },
    {
      name: 'native or remote inference bypasses the host Intel verdict',
      vendors: ['Intel Corporation'],
      native: true,
      expected: 'ok',
    },
    {
      name: 'Intel plus unknown controller is inconclusive',
      vendors: ['Intel Corporation', 'Future Graphics'],
      expected: 'ok',
    },
    {
      name: 'explicit Vulkan backend is not declared unsupported',
      vendors: ['Intel Corporation'],
      expected: 'ok',
      vulkan: true,
    },
    {
      name: 'custom container may provide an Intel backend',
      vendors: ['Intel Corporation'],
      image: 'example/intel-ollama:latest',
      expected: 'ok',
    },
    {
      name: 'Apple Metal keeps its native path',
      vendors: ['Apple'],
      native: true,
      apple: true,
      expected: 'apple_metal',
    },
  ]) {
    test(scenario.name, async ({ assert }) => {
      const methods = ['cpu', 'mem', 'osInfo', 'currentLoad', 'fsSize', 'time', 'graphics'] as const
      const originals = new Map(methods.map((name) => [name, si[name]]))
      const native = DockerService.isNativeOllama
      const mocks = {
        cpu: async () => ({ manufacturer: 'test', brand: 'test', cores: 8 }),
        mem: async () => ({}),
        osInfo: async () => ({
          platform: scenario.apple ? 'darwin' : 'linux',
          arch: scenario.apple ? 'arm64' : 'x64',
        }),
        currentLoad: async () => ({}),
        fsSize: async () => [],
        time: async () => ({}),
        graphics: async () => ({
          controllers: scenario.vendors.map((vendor) => ({ vendor, model: vendor })),
        }),
      }
      Object.assign(si, mocks)
      DockerService.isNativeOllama = () => scenario.native ?? false
      try {
        const service = new SystemService({
          docker: {
            info: async () => ({
              Architecture: scenario.apple ? 'aarch64' : 'x86_64',
              OperatingSystem: scenario.apple ? 'Docker Desktop' : 'Linux',
            }),
            getContainer: () => ({
              inspect: async () => ({
                Config: {
                  Image: scenario.image ?? 'ollama/ollama:0.15.2',
                  Env: scenario.vulkan ? ['OLLAMA_VULKAN=1'] : [],
                },
              }),
            }),
          },
        } as unknown as DockerService)
        const result = await service.getSystemInfo()
        assert.equal(result?.gpuHealth?.status, scenario.expected)
        assert.equal(result?.gpuHealth?.ollamaGpuAccessible, scenario.expected !== 'unsupported')
      } finally {
        for (const [name, original] of originals) Object.assign(si, { [name]: original })
        DockerService.isNativeOllama = native
      }
    })
  }
})
