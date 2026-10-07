/**
 * The upload glue for chat images, run for real: AdonisJS's own multipart body
 * parser, set up as config/bodyparser.ts sets it up, reading what a browser's
 * FormData sends, then handed to normalizeChatImages the way the controller
 * hands it. The other chat-image checks cover the pieces. This covers how they
 * meet, which no other check does because the controller cannot be booted here.
 *
 * It exists because the parser's extension check is case-sensitive. With an
 * extension list in the options, IMG_0001.JPG (how cameras name files) was
 * refused with a 415 although the page offered it.
 *
 * Run: node --experimental-strip-types tests/standalone/chat_upload.standalone.ts
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { CHAT_IMAGE_LIMITS, CHAT_IMAGE_UPLOAD_OPTIONS } from '../../constants/chat_images.ts'
import { normalizeChatImages, ChatImageError } from '../../app/utils/chat_images.ts'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const { BodyParserMiddlewareFactory } = await import(
  new URL('../../node_modules/@adonisjs/bodyparser/build/factories/main.js', import.meta.url).href
)
const { RequestFactory, ResponseFactory, HttpContextFactory } = await import(
  new URL('../../node_modules/@adonisjs/http-server/build/factories/main.js', import.meta.url).href
)

// The same multipart settings as config/bodyparser.ts.
const middleware = new BodyParserMiddlewareFactory()
  .merge({ multipart: { autoProcess: true, limit: '250mb', convertEmptyStringsToNull: true } })
  .create()

type Answer = { status: number; body: any }

const server = http.createServer(async (rq, rs) => {
  const request = new RequestFactory().merge({ req: rq, res: rs }).create()
  const response = new ResponseFactory().merge({ req: rq, res: rs }).create()
  const ctx = new HttpContextFactory().merge({ request, response }).create()
  const send = (status: number, body: unknown) => {
    rs.writeHead(status, { 'content-type': 'application/json' })
    rs.end(JSON.stringify(body))
  }
  try {
    await middleware.handle(ctx, async () => {
      // What the controller does, with the same options object.
      const files = ctx.request.files('images', CHAT_IMAGE_UPLOAD_OPTIONS)
      try {
        const images = await normalizeChatImages(files, CHAT_IMAGE_LIMITS)
        send(200, { count: images.length, names: images.map((i) => i.name) })
      } catch (error) {
        if (error instanceof ChatImageError) return send(error.status, { message: error.message })
        throw error
      }
    })
  } catch (error: any) {
    send(error?.status ?? 500, { thrown: error?.message })
  }
})
await new Promise<void>((resolve) => server.listen(0, resolve))
const port = (server.address() as any).port

async function upload(
  files: Array<{ name: string; bytes: Buffer; type: string }>
): Promise<Answer> {
  const form = new FormData()
  form.append(
    'payload',
    JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
  )
  for (const file of files)
    form.append('images', new File([file.bytes], file.name, { type: file.type }), file.name)
  const res = await fetch(`http://127.0.0.1:${port}/api/ollama/chat`, {
    method: 'POST',
    body: form,
  })
  return { status: res.status, body: await res.json() }
}

const picture = (format: 'jpeg' | 'png' | 'webp' | 'gif') =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 120, b: 10 } } })
    [format]()
    .toBuffer()
const jpeg = await picture('jpeg')
const png = await picture('png')
const webp = await picture('webp')
const gif = await picture('gif')

let passed = 0
const check = async (name: string, fn: () => Promise<void>) => {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

await check('a lower-case name is read', async () => {
  for (const [name, bytes, type] of [
    ['photo.jpg', jpeg, 'image/jpeg'],
    ['photo.jpeg', jpeg, 'image/jpeg'],
    ['shot.png', png, 'image/png'],
    ['pic.webp', webp, 'image/webp'],
  ] as const) {
    const answer = await upload([{ name, bytes, type }])
    assert.equal(answer.status, 200, `${name}: ${JSON.stringify(answer.body)}`)
    assert.deepEqual(answer.body.names, [name])
  }
})

await check('an upper-case name is read: IMG_0001.JPG is how cameras name files', async () => {
  for (const [name, bytes, type] of [
    ['IMG_0001.JPG', jpeg, 'image/jpeg'],
    ['IMG_0001.JPEG', jpeg, 'image/jpeg'],
    ['Screenshot.PNG', png, 'image/png'],
    ['PIC.WEBP', webp, 'image/webp'],
    ['Mixed.JpG', jpeg, 'image/jpeg'],
  ] as const) {
    const answer = await upload([{ name, bytes, type }])
    assert.equal(answer.status, 200, `${name}: ${JSON.stringify(answer.body)}`)
  }
})

await check('a JPEG with an unusual or missing extension is read', async () => {
  for (const name of ['photo.jfif', 'photo.jpe', 'photo', 'photo.jpg.backup']) {
    const answer = await upload([{ name, bytes: jpeg, type: 'image/jpeg' }])
    assert.equal(answer.status, 200, `${name}: ${JSON.stringify(answer.body)}`)
  }
})

await check('what is inside decides, not what the file is called', async () => {
  // A GIF is refused even when it is named like a JPEG...
  const named = await upload([{ name: 'IMG_0002.JPG', bytes: gif, type: 'image/jpeg' }])
  assert.equal(named.status, 415, JSON.stringify(named.body))
  assert.match(named.body.message, /"IMG_0002\.JPG" is not supported/)
  // ...and plain text named like a picture does not decode.
  const text = await upload([
    { name: 'notes.png', bytes: Buffer.from('not a picture'), type: 'image/png' },
  ])
  assert.equal(text.status, 422)
  assert.match(text.body.message, /notes\.png/)
})

await check('a GIF is turned away by name, as 415', async () => {
  const answer = await upload([{ name: 'anim.gif', bytes: gif, type: 'image/gif' }])
  assert.equal(answer.status, 415)
  assert.match(answer.body.message, /"anim\.gif" is not supported/)
})

await check('too many images are refused with the count in the message', async () => {
  const files = Array.from({ length: CHAT_IMAGE_LIMITS.maxImages + 1 }, (_, i) => ({
    name: `p${i}.jpg`,
    bytes: jpeg,
    type: 'image/jpeg',
  }))
  const answer = await upload(files)
  assert.equal(answer.status, 422)
  assert.match(answer.body.message, new RegExp(`no more than ${CHAT_IMAGE_LIMITS.maxImages}`))
})

await check(
  'a file over the size limit is refused as 413 by name, in any case of extension',
  async () => {
    const big = Buffer.alloc(CHAT_IMAGE_LIMITS.maxBytes + 1024)
    for (const name of ['huge.png', 'HUGE.PNG']) {
      const answer = await upload([{ name, bytes: big, type: 'image/png' }])
      assert.equal(answer.status, 413, `${name}: ${JSON.stringify(answer.body)}`)
      assert.match(answer.body.message, new RegExp(`"${name}" exceeds the 8 MB per-image limit`))
    }
  }
)

await check('several files arrive together, in order', async () => {
  const answer = await upload([
    { name: 'a.JPG', bytes: jpeg, type: 'image/jpeg' },
    { name: 'b.png', bytes: png, type: 'image/png' },
    { name: 'c.WEBP', bytes: webp, type: 'image/webp' },
  ])
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.body.names, ['a.JPG', 'b.png', 'c.WEBP'])
})

server.close()
console.log(`\n${passed} checks passed`)
