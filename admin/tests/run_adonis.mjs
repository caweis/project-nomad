import { spawn } from 'node:child_process'
import { hasPassingCaseSummary } from './check_adonis_output.mjs'

const child = spawn(process.execPath, ['ace', 'test', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
  process.stdout.write(chunk)
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
  process.stderr.write(chunk)
})

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  if (code !== 0 || signal) {
    process.exitCode = code || 1
    return
  }
  if (!hasPassingCaseSummary(output)) {
    console.error('Adonis ran no passing test summary; test gate failed')
    process.exitCode = 1
  }
})
