/**
 * Standalone test for the pure port-conflict error mapper (#934).
 *
 * `DockerService._humanizeDockerError` is a thin wrapper that supplies the
 * fork's Ollama service name and defers to `humanizeDockerError` in
 * `app/services/docker_errors.ts`. Only the pure mapper is exercised here under
 * `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/docker_errors.standalone.ts
 *
 * Ported from upstream commit 7288a0b's _humanizeDockerError logic.
 */
import assert from 'node:assert/strict'
import { humanizeDockerError } from '../../app/services/docker_errors.ts'

// The fork's SERVICE_NAMES.OLLAMA value (constants/service_names.ts).
const OLLAMA = 'nomad_ollama'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── 11434 → Ollama hint ───────────────────────────────────────────────────────
check('port 11434 conflict points at a host Ollama (matched by port, any service)', () => {
  const raw =
    '(HTTP code 500) server error - driver failed programming external connectivity on endpoint nomad_ollama: Bind for 0.0.0.0:11434 failed: port is already allocated'
  const out = humanizeDockerError(raw, 'nomad_qdrant', OLLAMA)
  assert.match(out, /port 11434 is already in use/)
  assert.match(out, /Ollama is already installed and running directly on the host/)
  assert.match(out, /systemctl stop ollama/)
})

check('Ollama service name triggers the Ollama hint even on a non-11434 port', () => {
  const raw = 'listen tcp 0.0.0.0:11435: bind: address already in use'
  const out = humanizeDockerError(raw, OLLAMA, OLLAMA)
  assert.match(out, /port 11435 is already in use/)
  assert.match(out, /Ollama is already installed/)
})

// ── generic port conflict → generic actionable message ────────────────────────
check('generic "port is already allocated" conflict names the port, no Ollama hint', () => {
  const raw = 'Bind for 0.0.0.0:8090 failed: port is already allocated'
  const out = humanizeDockerError(raw, 'nomad_flatnotes', OLLAMA)
  assert.match(out, /port 8090 is already in use/)
  assert.match(out, /Stop whatever is using port 8090 on the host/)
  assert.doesNotMatch(out, /Ollama/)
})

check('generic "bind: address already in use" conflict names the port, no Ollama hint', () => {
  const raw = 'listen tcp 0.0.0.0:8096: bind: address already in use'
  const out = humanizeDockerError(raw, 'nomad_kiwix', OLLAMA)
  assert.match(out, /port 8096 is already in use/)
  assert.match(out, /Stop whatever is using port 8096 on the host/)
  assert.doesNotMatch(out, /Ollama/)
})

// ── passthrough for anything unrecognized ─────────────────────────────────────
check('passes an unrecognized error through unchanged', () => {
  const raw = 'No such image: project-nomad/whatever:latest'
  const out = humanizeDockerError(raw, 'nomad_kiwix', OLLAMA)
  assert.equal(out, raw)
})

check('passes a plain disk-full error through unchanged', () => {
  const raw = 'write /var/lib/docker/tmp/xyz: no space left on device'
  const out = humanizeDockerError(raw, 'nomad_qdrant', OLLAMA)
  assert.equal(out, raw)
})

check('empty / unmatched message is returned as-is', () => {
  assert.equal(humanizeDockerError('', 'nomad_kiwix', OLLAMA), '')
})

console.log(`\n${passed} checks passed`)
