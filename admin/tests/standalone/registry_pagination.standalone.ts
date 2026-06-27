/**
 * Standalone test for the registry tag-list pagination-URL resolver (#945).
 *
 * `resolveNextPageUrl` is pure (only the global URL), so it runs under
 * `node --experimental-strip-types`:
 *   node --experimental-strip-types tests/standalone/registry_pagination.standalone.ts
 */
import assert from 'node:assert/strict'
import { resolveNextPageUrl } from '../../app/utils/registry_pagination.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── the regression: a relative next-URL must resolve against the registry origin ──
check('relative next URL resolves against the registry origin (>1000-tag repos)', () => {
  assert.equal(
    resolveNextPageUrl('/v2/ollama/ollama/tags/list?last=0.9.3&n=1000', 'registry-1.docker.io'),
    'https://registry-1.docker.io/v2/ollama/ollama/tags/list?last=0.9.3&n=1000'
  )
})

check('ghcr.io relative URL resolves against the ghcr origin', () => {
  assert.equal(
    resolveNextPageUrl('/v2/org/img/tags/list?last=t&n=1000', 'ghcr.io'),
    'https://ghcr.io/v2/org/img/tags/list?last=t&n=1000'
  )
})

// ── an already-absolute next URL is passed through unchanged ──
check('already-absolute next URL passes through unchanged', () => {
  assert.equal(
    resolveNextPageUrl('https://registry-1.docker.io/v2/x/tags/list?last=z&n=1000', 'registry-1.docker.io'),
    'https://registry-1.docker.io/v2/x/tags/list?last=z&n=1000'
  )
})

console.log(`\n${passed} passed`)
