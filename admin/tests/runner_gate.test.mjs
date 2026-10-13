import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const standaloneRunner = fileURLToPath(new URL('./run_standalone.mjs', import.meta.url))
const adonisOutputCheck = fileURLToPath(new URL('./check_adonis_output.mjs', import.meta.url))

function run(script, args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    ...options,
  })
}

test('standalone gate rejects an empty suite directory', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nomad-empty-tests-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const result = run(standaloneRunner, [directory])
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /no standalone tests/i)
})

test('standalone gate propagates a failing test and counts actual suites', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nomad-failing-tests-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'passes.standalone.mjs'), "console.log('pass fixture')\n")
  writeFileSync(join(directory, 'fails.standalone.mjs'), "throw new Error('deliberate fixture failure')\n")
  const result = run(standaloneRunner, [directory])
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /1 passed, 1 failed/)
})

test('Adonis output gate rejects a successful exit without a Japa case summary', () => {
  const result = run(adonisOutputCheck, [], {
    input: '[ info ] booting application to run tests...\nError: listen EPERM 0.0.0.0:3333\n',
  })
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /no passing test summary/i)
})

test('Adonis output gate accepts a real passing case summary', () => {
  const result = run(adonisOutputCheck, [], {
    input: ' PASSED \nTests  327 passed (327)\n Time 51ms\n',
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
