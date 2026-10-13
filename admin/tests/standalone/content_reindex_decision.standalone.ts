import assert from 'node:assert/strict'
import {
  decideContentReindex,
  decideDownloadIngest,
} from '../../app/utils/content_reindex_decision.ts'

const ready = {
  isReplacement: true,
  qdrantInstalled: true,
  oldFileWasIndexed: true,
  qdrantRunning: true,
}
let passed = 0
function check(name: string, outcome: string, expected: string) {
  assert.equal(outcome, expected, name)
  passed++
  console.log(`  ok - ${name}`)
}

check(
  'same-file download uses normal ingest policy',
  decideContentReindex({ ...ready, isReplacement: false }),
  'not_a_replacement'
)
check(
  'missing knowledge base is left alone',
  decideContentReindex({ ...ready, qdrantInstalled: false }),
  'qdrant_not_installed'
)
check(
  'browse-only replacement stays out of answers',
  decideContentReindex({ ...ready, oldFileWasIndexed: false }),
  'old_not_indexed'
)
check(
  'offline vector store defers reconciliation',
  decideContentReindex({ ...ready, qdrantRunning: false }),
  'qdrant_not_running'
)
check('indexed replacement reindexes', decideContentReindex(ready), 'reindex')
check(
  'no knowledge base skips fresh ingest',
  decideDownloadIngest(false, false, false, 'Always'),
  'skip'
)
check(
  'video replacement purges old passages',
  decideDownloadIngest(true, true, true, 'Always'),
  'purge_old'
)
check(
  'video fresh install stays browse-only',
  decideDownloadIngest(true, true, false, 'Always'),
  'skip'
)
check(
  'indexed replacement uses prior choice',
  decideDownloadIngest(true, false, true, 'Manual'),
  'reconcile'
)
check(
  'fresh Manual install waits for user',
  decideDownloadIngest(true, false, false, 'Manual'),
  'pending'
)
check(
  'fresh Always install queues embedding',
  decideDownloadIngest(true, false, false, 'Always'),
  'embed'
)

console.log(`\n${passed} passed`)
