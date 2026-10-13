/**
 * Standalone checks for reading a refusal from the chat endpoint, and for what
 * the chat box tells someone about attaching images (upstream edbfe1ad).
 *
 *   node --experimental-strip-types tests/standalone/chat_stream.standalone.ts
 */
import assert from 'node:assert/strict'
import { ChatRejectedError, chatHttpError, chatStreamError } from '../../inertia/lib/chat_stream.ts'
import { IMAGE_NOTICE, visionAttachmentGuidance } from '../../inertia/lib/vision_guidance.ts'

let passed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

const GENERIC = 'The model encountered an error. Please try again.'
const reply = (status: number, body: unknown) => ({
  status,
  json: async () => {
    if (body === 'unreadable') throw new SyntaxError('Unexpected token')
    return body
  },
})

// ── Events in the reply stream ──
await check('ordinary chunks and trailing events are not errors', () => {
  assert.equal(chatStreamError({ message: { content: 'hi' }, done: false }), null)
  assert.equal(chatStreamError({ sources: [{ title: 'x' }] }), null)
  assert.equal(chatStreamError({ error: false }), null)
  assert.equal(chatStreamError(null), null)
  assert.equal(chatStreamError('error'), null)
  assert.equal(chatStreamError(undefined), null)
})

await check('an error event with no message is the model failing, in generic words', () => {
  const error = chatStreamError({ error: true })
  assert.ok(error instanceof Error)
  assert.ok(!(error instanceof ChatRejectedError))
  assert.equal(error.message, GENERIC)
})

await check('an error event that carries a message was explained by the server', () => {
  const error = chatStreamError({ error: true, message: 'Choose a model that accepts images.' })
  assert.ok(error instanceof ChatRejectedError)
  assert.equal(error.message, 'Choose a model that accepts images.')
})

await check('a blank or non-text message does not count as an explanation', () => {
  for (const message of ['', '   ', 42, null, { text: 'x' }]) {
    const error = chatStreamError({ error: true, message })
    assert.ok(!(error instanceof ChatRejectedError), JSON.stringify(message))
    assert.equal(error?.message, GENERIC)
  }
})

// ── A request the server turned away ──
await check('a 422, 413 or 415 with a message is shown as the server wrote it', async () => {
  for (const status of [413, 415, 422]) {
    const error = await chatHttpError(
      reply(status, { message: '"cat.png" exceeds the 8 MB per-image limit.' })
    )
    assert.ok(error instanceof ChatRejectedError, String(status))
    assert.equal(error.message, '"cat.png" exceeds the 8 MB per-image limit.')
  }
})

await check('a 422 that is only a validation report keeps the plain status', async () => {
  // Validation failures carry an errors list and no top-level message.
  const error = await chatHttpError(
    reply(422, { errors: [{ message: 'The model field is required' }] })
  )
  assert.ok(!(error instanceof ChatRejectedError))
  assert.equal(error.message, 'HTTP error: 422')
})

await check('other failures are not believed, whatever their body says', async () => {
  // A 500 can carry a message that means nothing to the person reading it.
  for (const status of [400, 404, 500, 502]) {
    const error = await chatHttpError(reply(status, { message: 'Internal server error' }))
    assert.ok(!(error instanceof ChatRejectedError), String(status))
    assert.equal(error.message, `HTTP error: ${status}`)
  }
})

await check('a body that cannot be read falls back to the plain status', async () => {
  const error = await chatHttpError(reply(422, 'unreadable'))
  assert.ok(!(error instanceof ChatRejectedError))
  assert.equal(error.message, 'HTTP error: 422')
})

// ── What the chat box says ──
await check('a model that can see is told only how images are handled', () => {
  assert.equal(visionAttachmentGuidance('supported'), IMAGE_NOTICE)
})

await check('a model that cannot see is pointed at where to choose another', () => {
  const text = visionAttachmentGuidance('unsupported')
  assert.match(text, /cannot use images/)
  assert.match(text, /Input Type includes Image in Models & Settings/)
  assert.ok(
    !text.includes(IMAGE_NOTICE),
    'no point explaining how images are kept when none can be sent'
  )
})

await check('a model that has not said is allowed a try, with the risk named', () => {
  const text = visionAttachmentGuidance('unknown')
  assert.match(text, /cannot tell whether this model accepts images/)
  assert.match(text, /may fail, or the picture may be ignored/)
  assert.ok(
    !/will fail/.test(text),
    'what a text-only model does is not known, so it is not promised'
  )
  assert.ok(text.endsWith(IMAGE_NOTICE))
})

await check('the notice says images are not kept, so a follow-up cannot rely on them', () => {
  assert.match(IMAGE_NOTICE, /not saved/)
  assert.match(IMAGE_NOTICE, /ask about them in that message/)
  // The pictures stay on screen in the message that carried them until a reload,
  // so the notice must not say they vanish when sent.
  assert.ok(!/disappear after you send/.test(IMAGE_NOTICE))
  assert.match(IMAGE_NOTICE, /gone when you reload/)
})

console.log(`\n${passed} checks passed`)
