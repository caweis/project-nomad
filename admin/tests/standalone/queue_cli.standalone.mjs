import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// Exercise Ace's real command metadata validator; importing the class misses this failure.
const result = spawnSync(process.execPath, ['ace', 'queue:work', '--help'], {
  encoding: 'utf8',
  timeout: 20000,
})
assert.equal(result.status, 0, result.stdout + result.stderr)
assert.match(result.stdout, /Start processing jobs from the queue/)
assert.match(result.stdout, /--queue/)
console.log('1 passed: real queue command starts and exposes its flags')
