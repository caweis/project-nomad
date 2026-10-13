import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const defaultDirectory = fileURLToPath(new URL('./standalone/', import.meta.url))
const directory = resolve(process.argv[2] || defaultDirectory)
const files = [...globSync('*.standalone.{mjs,ts}', { cwd: directory })].sort()

if (files.length === 0) {
  console.error(`No standalone tests found in ${directory}`)
  process.exitCode = 1
} else {
  let passed = 0
  let failed = 0

  for (const file of files) {
    console.log(`\n[standalone] ${file}`)
    const result = spawnSync(process.execPath, ['--experimental-strip-types', resolve(directory, file)], {
      stdio: 'inherit',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: process.env,
    })
    if (result.error || result.status !== 0) {
      failed++
      if (result.error) console.error(result.error)
      console.error(`[standalone] FAIL ${file}${result.signal ? ` (${result.signal})` : ''}`)
    } else {
      passed++
      console.log(`[standalone] PASS ${file}`)
    }
  }

  console.log(`\nStandalone suites: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}
