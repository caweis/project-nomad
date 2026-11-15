import { test } from '@japa/runner'
import { DockerService } from '#services/docker_service'
import Service from '#models/service'
import { withLogRotation } from '../../app/utils/log_rotation.js'

test.group('container log policy', () => {
  test('caps the default json-file driver without mutating input', ({ assert }) => {
    const existing = { Config: { 'labels': 'project', 'max-file': '7' } }
    assert.deepEqual(withLogRotation(existing, 'json-file'), {
      Type: 'json-file',
      Config: { 'labels': 'project', 'max-size': '10m', 'max-file': '7' },
    })
    assert.deepEqual(existing.Config, { 'labels': 'project', 'max-file': '7' })
    assert.deepEqual(withLogRotation(undefined, 'json-file'), {
      Type: 'json-file',
      Config: { 'max-size': '10m', 'max-file': '3' },
    })
  })
  test('preserves explicit drivers and user limits', ({ assert }) => {
    for (const driver of ['none', 'local', 'journald', 'syslog']) {
      const existing = { Type: driver, Config: { tag: 'my-app' } }
      assert.strictEqual(withLogRotation(existing, 'json-file'), existing)
      assert.isUndefined(withLogRotation(undefined, driver))
    }
    const existing = { Type: 'json-file', Config: { 'max-size': '25m', 'max-file': '8' } }
    assert.strictEqual(withLogRotation(existing, 'json-file'), existing)
    assert.isUndefined(withLogRotation(undefined, undefined))
  })
})

test('custom app recreation sends the bounded log policy to Docker', async ({ assert }) => {
  const query = Service.query
  let saved = false
  const service = {
    container_image: 'fixture/app:1',
    container_config: { HostConfig: { Binds: ['fixture:/data'] } },
    save: async () => {
      saved = true
    },
  }
  ;(Service as any).query = () => ({ where: () => ({ first: async () => service }) })
  const docker = new DockerService()
  let created: any
  ;(docker as any)._applyHostStorageRoot = async () => {}
  ;(docker as any)._findContainerByName = async () => undefined
  ;(docker as any)._checkImageExists = async () => true
  ;(docker as any)._awaitContainerReady = async () => ({ ready: true })
  ;(docker as any).docker = {
    info: async () => ({ LoggingDriver: 'json-file' }),
    createContainer: async (config: any) => {
      created = config
      return { start: async () => {} }
    },
  }
  try {
    const result = await docker.recreateCustomAppContainer('fixture')
    assert.isTrue(result.success)
    assert.deepEqual(created.HostConfig, {
      Binds: ['fixture:/data'],
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
    })
    assert.isTrue(saved)
  } finally {
    Service.query = query
  }
})
