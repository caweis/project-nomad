/**
 * Standalone tests for tying a streamed reply to its reader.
 *
 *   node --experimental-strip-types tests/standalone/abortable_stream.standalone.ts
 *
 * The browser half of caweis#51 cancels the fetch; this is the server half. A
 * source that is never aborted keeps the model generating into a response
 * nobody will read, and the first thing that suffers is the next question.
 *
 * The fake source behaves the way ollama-js does where it matters: abort()
 * makes a pending read reject with an AbortError, and reading an aborted
 * source throws.
 */
import assert from 'node:assert/strict'
import { abortWith, type AbortableSource } from '../../app/utils/abortable_stream.ts'

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })

type Fake = AbortableSource<string> & { aborts: number }

/** Yields `items`, then either ends or, with `hang`, waits like a model still generating. */
function fakeSource(items: string[], hang = false): Fake {
  let rejectPending: ((error: Error) => void) | null = null
  const source: Fake = {
    aborts: 0,
    abort() {
      source.aborts++
      rejectPending?.(abortError())
    },
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        if (source.aborts > 0) throw abortError()
        yield item
      }
      if (hang) {
        await new Promise<never>((_, reject) => {
          // Stands in for a model that would generate forever. If nothing ever
          // aborts it, fail with a reason instead of letting the event loop
          // drain and exit 13 on an unsettled top-level await.
          const timer = setTimeout(() => reject(new Error('nothing ever stopped the source')), 1000)
          rejectPending = (error) => {
            clearTimeout(timer)
            reject(error)
          }
        })
      }
    },
  }
  return source
}

await check('a reply nobody leaves passes through whole and is never aborted', async () => {
  const source = fakeSource(['a', 'b', 'c'])
  const seen: string[] = []
  for await (const item of abortWith(source, new AbortController().signal)) seen.push(item)
  assert.deepEqual(seen, ['a', 'b', 'c'])
  assert.equal(source.aborts, 0)
})

await check('the reader leaving mid-reply aborts the source and ends the loop', async () => {
  const source = fakeSource(['a', 'b'], true)
  const reader = new AbortController()
  const seen: string[] = []
  await assert.rejects(async () => {
    for await (const item of abortWith(source, reader.signal)) {
      seen.push(item)
      // The browser goes away once two tokens are on screen; the source is
      // left waiting on the model, as a real one would be.
      if (seen.length === 2) setTimeout(() => reader.abort(), 0)
    }
  }, /This operation was aborted/)
  assert.deepEqual(seen, ['a', 'b'])
  assert.ok(source.aborts >= 1, 'the model must be told to stop')
})

await check('a reader already gone before the first token gets nothing and nothing is read', async () => {
  const source = fakeSource(['a', 'b'])
  const reader = new AbortController()
  reader.abort()
  const seen: string[] = []
  for await (const item of abortWith(source, reader.signal)) seen.push(item)
  assert.deepEqual(seen, [])
  assert.equal(source.aborts, 1)
})

await check('a consumer that stops reading early aborts the source', async () => {
  const source = fakeSource(['a', 'b', 'c'], true)
  for await (const item of abortWith(source, new AbortController().signal)) {
    if (item === 'a') break
  }
  assert.equal(source.aborts, 1)
})

await check('a consumer that throws aborts the source', async () => {
  const source = fakeSource(['a', 'b'], true)
  await assert.rejects(async () => {
    for await (const _ of abortWith(source, new AbortController().signal)) {
      throw new Error('write failed')
    }
  }, /write failed/)
  assert.equal(source.aborts, 1)
})

await check('with no signal at all, leaving early still aborts the source', async () => {
  const source = fakeSource(['a', 'b'], true)
  for await (const _ of abortWith(source)) break
  assert.equal(source.aborts, 1)
})

await check('a signal that fires after the reply finished does nothing', async () => {
  // 'close' fires on every response once it ends, not only on a disconnect,
  // so a listener left behind would abort a source that already completed.
  const source = fakeSource(['a'])
  const reader = new AbortController()
  for await (const _ of abortWith(source, reader.signal)) {
    // drain
  }
  reader.abort()
  assert.equal(source.aborts, 0)
})

console.log(`\n${passed} passed`)
