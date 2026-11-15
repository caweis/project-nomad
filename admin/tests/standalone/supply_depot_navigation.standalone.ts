import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = (path: string) => readFileSync(join(adminRoot, path), 'utf8')

const entryPoints = [
  'inertia/layouts/HomeLayout.tsx',
  'inertia/layouts/SettingsLayout.tsx',
  'inertia/pages/home.tsx',
  'inertia/pages/easy-setup/index.tsx',
  'inertia/pages/settings/benchmark.tsx',
]

for (const file of entryPoints) {
  const text = source(file)
  assert.ok(text.includes('/supply-depot'), `${file} must link to the card page`)
  assert.ok(!text.includes('/settings/apps'), `${file} still links to the retired table page`)
}

const routes = source('start/routes.ts')
assert.match(
  routes,
  /router\.on\(['"]\/settings\/apps['"]\)\.redirectToPath\(['"]\/supply-depot['"]\)/
)
assert.ok(existsSync(join(adminRoot, 'inertia/pages/settings/supply-depot.tsx')))
assert.ok(!existsSync(join(adminRoot, 'inertia/pages/settings/apps.tsx')))

const page = source('inertia/pages/settings/supply-depot.tsx')
const card = source('inertia/components/SupplyDepotCard.tsx')
assert.match(page, /onTogglePin: handleTogglePin/)
assert.match(page, /import \{ extractTag \} from '~\/lib\/imageTag'/)
assert.match(card, /label: 'Auto-update'/)
assert.match(card, /SERVICE_CREDENTIAL_NOTES\[record\.service_name\]/)
assert.match(card, /isPinned\(/)

console.log('Supply Depot navigation and legacy redirect checks passed')
