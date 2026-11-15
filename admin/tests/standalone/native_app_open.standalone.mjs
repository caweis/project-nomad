import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Children, isValidElement } from 'react'
import ts from 'typescript'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const modules = new Map()

// Load the actual TSX component and its local imports, including the URL resolver.
// Calling the card leaves child components as React elements, so no DOM is needed
// to inspect its actions and exercise the real Open click handler.
function loadSource(path) {
  const filename = ['', '.ts', '.tsx'].map((suffix) => path + suffix).find(existsSync)
  assert.ok(filename, `Missing source module: ${path}`)
  if (modules.has(filename)) return modules.get(filename).exports
  const module = { exports: {} }
  modules.set(filename, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('~/')) {
      return loadSource(resolve(adminRoot, 'inertia', specifier.slice(2)))
    }
    if (specifier.startsWith('.')) {
      return loadSource(resolve(dirname(filename), specifier.replace(/\.js$/, '')))
    }
    return require(specifier)
  }
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  })
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports)
  return module.exports
}

const { default: SupplyDepotCard } = loadSource(
  resolve(adminRoot, 'inertia/components/SupplyDepotCard.tsx')
)
const { default: StyledButton } = loadSource(
  resolve(adminRoot, 'inertia/components/StyledButton.tsx')
)
const { default: HostCommandButton } = loadSource(
  resolve(adminRoot, 'inertia/components/HostCommandButton.tsx')
)

function descendants(element) {
  if (!isValidElement(element)) return []
  return [element, ...Children.toArray(element.props.children).flatMap(descendants)]
}

for (const aiBackend of ['omlx', 'ollama']) {
  for (const [uiLocation, customUrl, expectedUrl] of [
    ['/chat', null, '/chat'],
    ['/chat', 'https://chat.example.test/ui', 'https://chat.example.test/ui'],
    ['https:9443', null, 'https://nomad.test:9443'],
  ]) {
    test(`${aiBackend} opens ${expectedUrl} without changing host actions`, () => {
      const priorWindow = globalThis.window
      const opened = []
      globalThis.window = {
        location: { hostname: 'nomad.test' },
        open: (...args) => opened.push(args),
      }
      try {
        const card = SupplyDepotCard({
          record: {
            service_name: 'nomad_ollama',
            friendly_name: 'AI Assistant',
            installed: true,
            ui_location: uiLocation,
            custom_url: customUrl,
          },
          isNativeOllama: true,
          aiBackend,
          pins: {},
          isOnline: false,
          isInstalling: false,
          loading: false,
          handlers: {},
        })
        const actions = descendants(card)
        const open = actions.find(
          (node) => node.type === StyledButton && node.props.children === 'Open'
        )
        assert.ok(open, 'Native AI card must offer Open')
        assert.notEqual(open.props.disabled, true, 'Opening offline chat does not require internet')
        open.props.onClick()
        assert.deepEqual(opened, [[expectedUrl, '_blank']])
        assert.deepEqual(
          actions.filter((node) => node.type === HostCommandButton).map((node) => node.props.cmd),
          aiBackend === 'omlx' ? ['reset-ollama'] : ['upgrade-ollama', 'reset-ollama']
        )
      } finally {
        if (priorWindow === undefined) delete globalThis.window
        else globalThis.window = priorWindow
      }
    })
  }
}
