/**
 * Standalone gate test for the Supply Depot per-app docs map.
 *
 * Proves the docs map (constants/supply_depot_docs.ts), the catalog
 * (constants/service_names.ts + the seeder's dependency flag), and the docs
 * markdown (docs/supply-depot-apps.md) stay in lockstep. Run:
 *   node --experimental-strip-types tests/standalone/supply_depot_docs.standalone.ts
 *
 * Node's `--experimental-strip-types` does NOT rewrite a `.js` import specifier
 * to its sibling `.ts` file (verified on v26), and supply_depot_docs.ts imports
 * `./service_names.js` (required for the real AdonisJS NodeNext build). So this
 * test cannot `import` the map module directly — it reads the three source
 * files as text and validates them structurally, the same approach
 * supply_depot_schema.standalone.ts uses for the seeder/sqlite artifacts.
 *
 * Checks:
 *  - every non-dependency SERVICE_NAMES key has a docs entry (QDRANT, the
 *    dependency service, does NOT);
 *  - anchors are unique;
 *  - every anchor resolves to a `{% #anchor %}` heading id in the .md, so the
 *    "Learn more" deep-link never points at a section that doesn't exist.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const constantsDir = path.resolve(here, '../../constants')
const docsDir = path.resolve(here, '../../docs')

// ── parse SERVICE_NAMES keys from the constants source ────────────────────────
const serviceNamesSrc = readFileSync(path.join(constantsDir, 'service_names.ts'), 'utf8')
const serviceKeys = new Set<string>()
for (const m of serviceNamesSrc.matchAll(/^\s*([A-Z0-9_]+)\s*:/gm)) {
  serviceKeys.add(m[1])
}

// ── parse the docs map: which SERVICE_NAMES.<KEY> entries + their anchors ──────
const docsSrc = readFileSync(path.join(constantsDir, 'supply_depot_docs.ts'), 'utf8')
// Only scan the SUPPLY_DEPOT_DOCS object body so helper references don't count.
const objMatch = docsSrc.match(/SUPPLY_DEPOT_DOCS[^{]*\{([\s\S]*?)\n\}/)
assert.ok(objMatch, 'could not locate the SUPPLY_DEPOT_DOCS object literal')
const objBody = objMatch![1]
const mappedKeys: string[] = []
const mappedAnchors: string[] = []
for (const m of objBody.matchAll(
  /\[SERVICE_NAMES\.([A-Z0-9_]+)\]\s*:\s*\{[^}]*anchor:\s*'([a-z0-9-]+)'/g
)) {
  mappedKeys.push(m[1])
  mappedAnchors.push(m[2])
}
const mappedKeySet = new Set(mappedKeys)

// Dependency services excluded from the Supply Depot (is_dependency_service:
// true in the seeder). QDRANT is the only one in this catalog.
const DEPENDENCY_KEYS = new Set<string>(['QDRANT'])

check('the constants parse produced a non-trivial catalog and map', () => {
  assert.ok(serviceKeys.size >= 9, `expected >= 9 service keys, got ${serviceKeys.size}`)
  assert.ok(mappedKeys.length >= 9, `expected >= 9 mapped entries, got ${mappedKeys.length}`)
})

check('every non-dependency SERVICE_NAMES key has a docs entry', () => {
  for (const key of serviceKeys) {
    if (DEPENDENCY_KEYS.has(key)) continue
    assert.ok(mappedKeySet.has(key), `missing docs entry for SERVICE_NAMES.${key}`)
  }
})

check('the dependency service (QDRANT) has NO docs entry', () => {
  assert.ok(!mappedKeySet.has('QDRANT'), 'QDRANT must not be in the docs map')
})

check('the docs map only references known SERVICE_NAMES keys', () => {
  for (const key of mappedKeys) {
    assert.ok(serviceKeys.has(key), `docs map references unknown key SERVICE_NAMES.${key}`)
  }
})

check('all anchors are unique', () => {
  assert.equal(new Set(mappedAnchors).size, mappedAnchors.length, 'duplicate anchor detected')
})

// ── parse the .md heading anchors ─────────────────────────────────────────────
const md = readFileSync(path.join(docsDir, 'supply-depot-apps.md'), 'utf8')
const headingAnchors = new Set<string>()
for (const m of md.matchAll(/\{%\s*#([a-z0-9-]+)\s*%\}/g)) {
  headingAnchors.add(m[1])
}

check('the docs page declares at least one heading anchor', () => {
  assert.ok(headingAnchors.size > 0, 'no `{% #anchor %}` headings found in the .md')
})

check('every mapped anchor exists as a heading id in the .md', () => {
  for (let i = 0; i < mappedKeys.length; i++) {
    assert.ok(
      headingAnchors.has(mappedAnchors[i]),
      `anchor "${mappedAnchors[i]}" for SERVICE_NAMES.${mappedKeys[i]} has no matching heading in supply-depot-apps.md`
    )
  }
})

console.log(`\n${passed} checks passed`)
