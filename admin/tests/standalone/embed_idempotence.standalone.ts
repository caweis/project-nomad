import assert from 'node:assert/strict'
import {
  continuationJobId,
  stableVectorPointId,
  stableZimDocumentId,
} from '../../util/embed_jobs.ts'

const id = stableVectorPointId('/library/book.zim', 'zim:50:3', 0)
assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
assert.equal(stableVectorPointId('/library/book.zim', 'zim:50:3', 0), id)
assert.notEqual(stableVectorPointId('/library/book.zim', 'zim:50:4', 0), id)
assert.notEqual(stableVectorPointId('/library/book.zim', 'zim:50:3', 1), id)
assert.notEqual(stableVectorPointId('/library/other.zim', 'zim:50:3', 0), id)

const next = continuationJobId('run-123', 50)
assert.equal(continuationJobId('run-123', 50), next)
assert.notEqual(continuationJobId('run-123', 100), next)
assert.notEqual(continuationJobId('run-456', 50), next)
assert.ok(!next.includes(':'))

assert.equal(
  stableZimDocumentId('/library/book.zim', 'A/Article'),
  stableZimDocumentId('/library/book.zim', 'A/Article')
)
assert.notEqual(
  stableZimDocumentId('/library/book.zim', 'A/Article'),
  stableZimDocumentId('/library/book.zim', 'B/Article')
)

console.log('embed_idempotence: 11 passed')
