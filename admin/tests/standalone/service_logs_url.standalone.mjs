import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import * as React from 'react'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import ts from 'typescript'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

// Execute the real controller, value/schema validators, KV serialization, service,
// hooks, and TSX handlers. Only external side effects (DB, HTTP, React mounting)
// are replaced. This never loads an installed NOMAD database or starts its server.
function harness() {
  const modules = new Map()
  const components = new Map()
  const rows = new Map()
  const notifications = []
  const writes = []
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let state = []
  let stateIndex = 0
  let pending
  let apiResult
  const component = (name) => {
    if (!components.has(name)) components.set(name, function Component() {})
    return components.get(name)
  }
  const api = {
    getSetting: async (key) => {
      const result = await controller.getSetting(context({ key }))
      return result.body
    },
    updateSetting: async (key, value) => {
      if (apiResult !== undefined) return apiResult()
      const result = await controller.updateSetting(context({ key, value }))
      return result.status === 200 ? result.body : undefined
    },
  }
  const stubs = {
    'react': {
      ...React,
      useState: (initial) => {
        const index = stateIndex++
        if (!(index in state)) state[index] = initial
        const current = state
        return [
          current[index],
          (value) => {
            current[index] = value
          },
        ]
      },
    },
    '@inertiajs/react': {
      Head: component('Head'),
      usePage: () => ({ props: { aiAssistantName: 'AI Assistant' } }),
    },
    '@tabler/icons-react': new Proxy({}, { get: (_, key) => component(key) }),
    '@tanstack/react-query': {
      useQueryClient: () => queryClient,
      useQuery: ({ queryKey }) => ({ data: queryClient.getQueryData(queryKey) }),
      useMutation: (options) => ({
        isPending: false,
        mutate: (value) => {
          pending = Promise.resolve()
            .then(() => options.mutationFn(value))
            .then((result) => options.onSuccess?.(result, value))
            .catch((error) => options.onError?.(error))
        },
      }),
    },
    '~/lib/api': { default: api },
    '~/context/NotificationContext': {
      useNotifications: () => ({ addNotification: (entry) => notifications.push(entry) }),
    },
    '~/hooks/useServiceInstalledStatus': { default: () => ({ isInstalled: false }) },
    '@adonisjs/core': { inject: () => (target) => target },
    '@adonisjs/lucid/orm': {
      BaseModel: class {},
      SnakeCaseNamingStrategy: class {},
      column: Object.assign(() => () => {}, { dateTime: () => () => {} }),
    },
    '@adonisjs/core/services/logger': { default: {} },
    '#start/env': { default: { get: () => undefined } },
    '#models/service': { default: class {} },
    '../utils/fs.js': {},
  }

  function loadSource(path) {
    const base = path.replace(/\.js$/, '')
    const filename = ['', '.ts', '.tsx'].map((suffix) => base + suffix).find(existsSync)
    assert.ok(filename, `Missing source module: ${path}`)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const localRequire = (specifier) => {
      if (Object.hasOwn(stubs, specifier)) {
        const stub = stubs[specifier]
        return Object.hasOwn(stub, 'default') ? { __esModule: true, ...stub } : stub
      }
      if (specifier === '#models/kv_store')
        return loadSource(resolve(adminRoot, 'app/models/kv_store.ts'))
      if (specifier === '#validators/settings')
        return loadSource(resolve(adminRoot, 'app/validators/settings.ts'))
      if (specifier.startsWith('#services/')) return {}
      if (specifier.startsWith('~/components/'))
        return { __esModule: true, default: component(specifier) }
      if (specifier.startsWith('~/'))
        return loadSource(resolve(adminRoot, 'inertia', specifier.slice(2)))
      if (specifier.startsWith('.')) return loadSource(resolve(dirname(filename), specifier))
      return require(specifier)
    }
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        experimentalDecorators: true,
      },
    })
    new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports)
    return module.exports
  }

  const { default: KVStore } = loadSource(resolve(adminRoot, 'app/models/kv_store.ts'))
  KVStore.findBy = async (_, key) => rows.get(key) ?? null
  KVStore.firstOrCreate = async ({ key }, initial) => {
    if (!rows.has(key))
      rows.set(key, {
        ...initial,
        save: async () => {
          writes.push(key)
        },
      })
    return rows.get(key)
  }
  const { SystemService } = loadSource(resolve(adminRoot, 'app/services/system_service.ts'))
  const { default: SettingsController } = loadSource(
    resolve(adminRoot, 'app/controllers/settings_controller.ts')
  )
  const controller = new SettingsController(new SystemService({}), {}, {}, {})
  const schemas = loadSource(resolve(adminRoot, 'app/validators/settings.ts'))

  function context(payload) {
    const result = { status: 200, body: null }
    return {
      request: { qs: () => payload, validateUsing: (schema) => schema.validate(payload) },
      response: {
        status: (code) => {
          result.status = code
          return { send: (body) => ({ ...result, body }) }
        },
      },
      inertia: { render: (page, props) => ({ page, props }) },
    }
  }
  function render(fn, props, hookState = []) {
    state = hookState
    stateIndex = 0
    return fn(props)
  }
  return {
    loadSource,
    schemas,
    controller,
    context,
    KVStore,
    rows,
    writes,
    queryClient,
    notifications,
    render,
    components,
    flush: () => pending,
    setApiResult: (fn) => {
      apiResult = fn
    },
  }
}

function descendants(element) {
  if (!React.isValidElement(element)) return []
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)]
}

const key = 'ui.serviceLogsUrl'

for (const value of [
  'https://logs.example.test/path',
  'http://logs.lan:9999',
  'logs.lan',
  '10.0.0.5:9999',
  '  logs.lan  ',
  '',
  '  ',
  null,
  undefined,
]) {
  test(`accepts a supported Service Logs URL or clear: ${String(value)}`, async () => {
    const h = harness()
    const payload = await h.schemas.updateSettingSchema.validate({ key, value })
    assert.equal(h.schemas.validateSettingValue(payload.key, payload.value), null)
    h.queryClient.clear()
  })
}

for (const value of [
  'file:///etc/passwd',
  'ftp://logs.lan',
  'gopher://logs.lan',
  'javascript:alert(1)',
  'data:text/html,test',
  'not a url',
  'http://',
  '://logs.lan',
  'x'.repeat(256),
  42,
  true,
  ['https://logs.lan'],
]) {
  test(`rejects an unsupported Service Logs URL before storing: ${String(value).slice(0, 40)}`, async () => {
    const h = harness()
    assert.equal(typeof h.schemas.validateSettingValue(key, value), 'string')
    const result = await h.controller.updateSetting(h.context({ key, value }))
    assert.equal(result.status, 422)
    assert.equal(result.body.success, false)
    assert.equal(h.rows.size, 0)
    h.queryClient.clear()
  })
}

test('the actual controller/service/KV path normalizes, reads back, and clears the setting', async () => {
  const h = harness()
  try {
    assert.equal((await h.controller.advanced(h.context())).props.advanced.serviceLogsUrl, '')
    for (const clear of ['', '  \t\n ', null, undefined]) {
      assert.equal(
        (await h.controller.updateSetting(h.context({ key, value: '  logs.lan:9999  ' }))).status,
        200
      )
      assert.equal(
        (await h.controller.getSetting(h.context({ key }))).body.value,
        'http://logs.lan:9999/'
      )
      assert.equal(
        (await h.controller.advanced(h.context())).props.advanced.serviceLogsUrl,
        'http://logs.lan:9999/'
      )
      assert.equal((await h.controller.updateSetting(h.context({ key, value: clear }))).status, 200)
      assert.equal(await h.KVStore.getValue(key), null)
      assert.equal(h.rows.get(key).value, null)
      assert.equal((await h.controller.advanced(h.context())).props.advanced.serviceLogsUrl, '')
    }
  } finally {
    h.queryClient.clear()
  }
})

test('Advanced is routed through SettingsController', () => {
  const routes = readFileSync(resolve(adminRoot, 'start/routes.ts'), 'utf8')
  assert.match(routes, /router\.get\('\/advanced', \[SettingsController, 'advanced'\]\)/)
})

test('saving and clearing refresh both sidebar hrefs through the observed query', async () => {
  const h = harness()
  const priorWindow = globalThis.window
  globalThis.window = { location: { hostname: 'nomad.test' } }
  let unsubscribe
  try {
    const Page = h.loadSource(resolve(adminRoot, 'inertia/pages/settings/advanced.tsx')).default
    const layouts = ['HomeLayout', 'SettingsLayout'].map(
      (name) => h.loadSource(resolve(adminRoot, `inertia/layouts/${name}.tsx`)).default
    )
    const observer = new QueryObserver(h.queryClient, {
      queryKey: ['system-setting', key],
      queryFn: async () => (await h.controller.getSetting(h.context({ key }))).body,
      staleTime: Infinity,
    })
    unsubscribe = observer.subscribe(() => {})
    await observer.refetch()
    const hrefs = () =>
      layouts.map((Layout) => {
        const sidebar = descendants(h.render(Layout, { children: null })).find(
          (node) => node.type === h.components.get('~/components/StyledSidebar')
        )
        assert.ok(sidebar.props.items.some((item) => item.href === '/settings/advanced'))
        return sidebar.props.items.find((item) => item.name === 'Service Logs & Metrics').href
      })
    assert.deepEqual(hrefs(), ['http://nomad.test:9999', 'http://nomad.test:9999'])
    const pageState = []
    const draw = () => descendants(h.render(Page, { advanced: { serviceLogsUrl: '' } }, pageState))
    for (const [input, expected] of [
      ['  https://logs.example.test/ui  ', 'https://logs.example.test/ui'],
      ['   ', 'http://nomad.test:9999'],
    ]) {
      draw()
        .find((node) => node.props.name === 'serviceLogsUrl')
        .props.onChange({ target: { value: input } })
      draw()
        .find((node) => node.type === h.components.get('~/components/StyledButton'))
        .props.onClick()
      await h.flush()
      assert.deepEqual(hrefs(), [expected, expected])
      assert.equal(h.notifications.at(-1).type, 'success')
    }
  } finally {
    unsubscribe?.()
    h.queryClient.clear()
    if (priorWindow === undefined) delete globalThis.window
    else globalThis.window = priorWindow
  }
})

test('the form reports failed saves and refuses invalid URLs without changing cached links', async () => {
  const h = harness()
  try {
    const Page = h.loadSource(resolve(adminRoot, 'inertia/pages/settings/advanced.tsx')).default
    h.queryClient.setQueryData(['system-setting', key], { key, value: 'https://old.example.test/' })
    h.setApiResult(() => undefined) // api.updateSetting catches a rejected HTTP call
    const pageState = []
    const draw = () =>
      descendants(
        h.render(Page, { advanced: { serviceLogsUrl: 'https://new.example.test/' } }, pageState)
      )
    draw()
      .find((node) => node.type === h.components.get('~/components/StyledButton'))
      .props.onClick()
    await h.flush()
    assert.equal(h.notifications.at(-1).type, 'error')
    assert.equal(
      h.queryClient.getQueryData(['system-setting', key]).value,
      'https://old.example.test/'
    )
    assert.equal(h.queryClient.getQueryState(['system-setting', key]).isInvalidated, false)
    h.setApiResult(() => {
      assert.fail('invalid URL must not be sent')
    })
    draw()
      .find((node) => node.props.name === 'serviceLogsUrl')
      .props.onChange({ target: { value: 'file:///etc/passwd' } })
    draw()
      .find((node) => node.type === h.components.get('~/components/StyledButton'))
      .props.onClick()
    assert.equal(draw().find((node) => node.props.name === 'serviceLogsUrl').props.error, true)
  } finally {
    h.queryClient.clear()
  }
})
