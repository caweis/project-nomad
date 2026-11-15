import { test } from '@japa/runner'
import { DocsService } from '#services/docs_service'
import SystemController from '#controllers/system_controller'
import Service from '#models/service'

test.group('November app regressions', (group) => {
  group.teardown(async () => {
    const { default: queueConfig } = await import('#config/queue')
    queueConfig.connection.disconnect()
  })
  test('renders a hard-wrapped bold span that Markdoc only warns about', ({ assert }) => {
    const rendered = new DocsService().parse('**one\ntwo**')
    assert.isNotNull(rendered)
  })

  test('still rejects unknown tags', ({ assert }) => {
    assert.throws(() => new DocsService().parse('{% nonexistent /%}'), /Markdoc validation failed/)
  })

  for (const [before, ports, after] of [
    ['/chat', [{ container: 11434, host: 11434 }], '/chat'],
    ['/chat', [], '/chat'],
    ['/custom/page', [{ container: 80, host: 8000 }], '/custom/page'],
    ['https:8480', [{ container: 443, host: 9443 }], 'https:9443'],
    ['8080', [{ container: 80, host: 8000 }], '8000'],
  ] as const) {
    test(`app edit preserves UI intent: ${before} → ${after} (${ports.length} ports)`, async ({
      assert,
    }) => {
      let saved = false
      let recreated = false
      const service = {
        ui_location: before,
        is_dependency_service: false,
        container_config: '{}',
        save: async () => {
          saved = true
        },
      }
      const originalQuery = Service.query
      ;(Service as any).query = () => ({
        where() {
          return this
        },
        first: async () => service,
      })
      try {
        const controller = new SystemController(
          {} as any,
          {
            recreateCustomAppContainer: async () => {
              recreated = true
              return { success: true }
            },
          } as any,
          {} as any,
          {} as any
        )
        await controller.updateCustomApp({
          request: {
            validateUsing: async () => ({
              service_name: 'nomad_ollama',
              friendly_name: 'AI Assistant',
              image: 'ollama/ollama:latest',
              ports,
              volumes: [],
              force: true,
            }),
          },
          response: {
            send: (body: unknown) => body,
            status() {
              return this
            },
          },
        } as any)
        assert.isTrue(saved)
        assert.isTrue(recreated)
        assert.equal(service.ui_location, after)
      } finally {
        Service.query = originalQuery
      }
    })
  }
})
