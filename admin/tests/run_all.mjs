import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const commands = [
  ['Adonis discovery guard', ['tests/standalone/test_discovery.standalone.mjs']],
  ['Adonis unit tests', ['tests/run_adonis.mjs', '--no-assets']],
  ['Runner regression tests', ['--test', 'tests/runner_gate.test.mjs']],
  ['Standalone suites', ['tests/run_standalone.mjs']],
]

for (const [label, args] of commands) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(process.execPath, args, {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) console.error(result.error)
  if (result.error || result.status !== 0) {
    console.error(`${label} failed${result.signal ? ` (${result.signal})` : ''}`)
    process.exit(result.status || 1)
  }
}
