import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import YAML from 'yaml'

const path =
  process.argv[2] ||
  new URL('../../../.github/workflows/validate-collection-urls.yml', import.meta.url)
const workflow = YAML.parse(readFileSync(path, 'utf8'))
const steps = workflow.jobs['validate-urls'].steps
const reporting = steps.find((step) => step.name === 'Report main catalog status')
const checking = steps.find((step) => step.id === 'catalog')
assert.ok(reporting && checking, 'Catalog checking and reporting must remain connected')
assert.equal(workflow.concurrency['cancel-in-progress'], false)

// These checked-in expressions use the operators shared by JavaScript and Actions.
// Evaluate the actual YAML with fixture contexts so tests do not copy its conditions.
function evaluate(expression, github, outcome) {
  return runInNewContext(
    expression,
    {
      github,
      steps: { catalog: { outcome } },
      always: () => true,
    },
    { timeout: 100 }
  )
}
function group(github) {
  return workflow.concurrency.group.replace(/\$\{\{([\s\S]+?)\}\}/g, (_, expression) =>
    String(evaluate(expression, github, 'success'))
  )
}

let allowed = 0
for (const event_name of ['schedule', 'workflow_dispatch', 'push', 'pull_request']) {
  for (const ref of ['refs/heads/main', 'refs/heads/fix', 'refs/pull/88/merge']) {
    for (const outcome of ['success', 'failure', 'cancelled', 'skipped']) {
      const expected =
        ref === 'refs/heads/main' &&
        ['schedule', 'workflow_dispatch'].includes(event_name) &&
        ['success', 'failure'].includes(outcome)
      const actual = evaluate(reporting.if, { event_name, ref, run_id: '1' }, outcome)
      assert.equal(actual, expected, `${event_name} ${ref} ${outcome}`)
      if (actual) allowed++
    }
  }
}
assert.equal(allowed, 4)

const schedule = { event_name: 'schedule', ref: 'refs/heads/main', run_id: '10' }
const manual = { ...schedule, event_name: 'workflow_dispatch', run_id: '11' }
assert.equal(group(schedule), group(manual), 'Main reporting runs must serialize issue writes')
for (const other of [
  { ...schedule, event_name: 'push', run_id: '12' },
  { ...schedule, event_name: 'push', run_id: '13' },
  { ...manual, ref: 'refs/heads/fix', run_id: '14' },
  { ...schedule, event_name: 'pull_request', ref: 'refs/pull/88/merge', run_id: '15' },
]) {
  assert.notEqual(
    group(other),
    group(schedule),
    'Non-reporting runs must not evict a pending report'
  )
}

const directory = mkdtempSync(join(tmpdir(), 'nomad-catalog-workflow-'))
try {
  mkdirSync(join(directory, '.github/scripts'), { recursive: true })
  for (const code of [0, 1]) {
    const line = code
      ? 'FAILED: https://example.test/book (HTTP 404)'
      : 'OK: https://example.test/book (200 via HEAD)'
    writeFileSync(
      join(directory, '.github/scripts/check-collection-urls.sh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' '${line}'\nexit ${code}\n`
    )
    const result = spawnSync('bash', ['-e', '-c', checking.run], {
      cwd: directory,
      encoding: 'utf8',
    })
    assert.equal(
      result.status,
      code,
      'The actual workflow must preserve validator failure through tee'
    )
    assert.equal(readFileSync(join(directory, 'catalog-urls.log'), 'utf8'), `${line}\n`)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
console.log(
  'Catalog workflow: 48 eligibility cases, reporting isolation and both validator outcomes passed'
)
