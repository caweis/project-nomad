import { test } from '@japa/runner'
import {
  isTerminalDownloadFailure,
  shouldRecordDownloadFailure,
  DOWNLOAD_CANCELLED_PREFIX,
} from '../../app/utils/download_failure.js'

test('terminal failures include skipped retries but not intermediate attempts or cancellation backoff', ({
  assert,
}) => {
  const pending = { finishedOn: undefined, data: { resourceMetadata: { auto: true } } }
  assert.isFalse(isTerminalDownloadFailure(pending))
  assert.isFalse(shouldRecordDownloadFailure(pending, new Error('network')))
  const terminal = { ...pending, finishedOn: Date.now(), attemptsMade: 1, opts: { attempts: 3 } }
  assert.isTrue(isTerminalDownloadFailure(terminal))
  assert.isTrue(shouldRecordDownloadFailure(terminal, new Error('disk full')))
  assert.isFalse(
    shouldRecordDownloadFailure(terminal, new Error(DOWNLOAD_CANCELLED_PREFIX + 'by user'))
  )
  assert.isFalse(shouldRecordDownloadFailure({ ...terminal, data: {} }, new Error('disk full')))
})
