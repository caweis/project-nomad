import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const config = readFileSync(new URL('../../adonisrc.ts', import.meta.url), 'utf8')
const unitPattern = config.match(/files:\s*\[\s*['"]([^'"]+)['"]\s*\],\s*name:\s*['"]unit['"]/)?.[1]

assert.ok(unitPattern, 'Adonis must define a unit test suite')

const files = [...globSync(unitPattern, { cwd: appRoot })]
assert.ok(files.length > 0, `Adonis unit glob matched no spec files: ${unitPattern}`)

console.log(`Adonis unit glob matches ${files.length} spec files`)
