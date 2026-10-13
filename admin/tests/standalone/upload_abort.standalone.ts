/**
 * What an interrupted multipart upload leaves behind, and the sweep that clears
 * it, with the real AdonisJS body parser.
 *
 * When a request fails inside the parser (the tab closes, the connection drops)
 * the controller never runs, so nothing deletes the files the parser had already
 * finished. Found for chat pictures, whose originals still carry their camera
 * and location details, by a review that ran the parser the way this does.
 *
 * Run: node --experimental-strip-types tests/standalone/upload_abort.standalone.ts
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  UPLOAD_TMP_PREFIX,
  sweepStaleUploads,
  uploadTmpFileName,
} from '../../app/utils/stale_uploads.ts'

const { BodyParserMiddlewareFactory } = await import(
  new URL('../../node_modules/@adonisjs/bodyparser/build/factories/main.js', import.meta.url).href
)
const { RequestFactory, ResponseFactory, HttpContextFactory } = await import(
  new URL('../../node_modules/@adonisjs/http-server/build/factories/main.js', import.meta.url).href
)

const dir = await mkdtemp(join(tmpdir(), 'upload-abort-'))
let controllerRuns = 0
const middleware = new BodyParserMiddlewareFactory()
  .merge({
    multipart: {
      autoProcess: true,
      limit: '250mb',
      convertEmptyStringsToNull: true,
      // The app's own naming, in a folder of the test's own.
      tmpFileName: () => join(dir, uploadTmpFileName()),
    },
  })
  .create()

const server = http.createServer(async (req, res) => {
  const request = new RequestFactory().merge({ req, res }).create()
  const response = new ResponseFactory().merge({ req, res }).create()
  const ctx = new HttpContextFactory().merge({ request, response }).create()
  try {
    await middleware.handle(ctx, async () => {
      controllerRuns++
      res.end('{}')
    })
  } catch {
    if (!res.destroyed) {
      res.writeHead(400)
      res.end()
    }
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address() as net.AddressInfo

const B = '----abandoned'
const part = (headers: string, body: Buffer) =>
  Buffer.concat([Buffer.from(`--${B}\r\n${headers}\r\n\r\n`), body, Buffer.from('\r\n')])
const file = (name: string, bytes: Buffer) =>
  part(
    `Content-Disposition: form-data; name="images"; filename="${name}"\r\nContent-Type: image/jpeg`,
    bytes
  )

// A request that declares more than it sends: one photo arrives whole, the
// second is cut off, and the client goes away.
await new Promise<void>((resolve) => {
  const socket = net.connect(port, '127.0.0.1', () => {
    socket.write(
      `POST /api/ollama/chat HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=${B}\r\n` +
        `Content-Length: 10000000\r\n\r\n`
    )
    socket.write(file('first.jpg', Buffer.alloc(50_000, 7)))
    socket.write(
      Buffer.concat([
        Buffer.from(
          `--${B}\r\nContent-Disposition: form-data; name="images"; filename="second.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ),
        Buffer.alloc(20_000, 9),
      ])
    )
    setTimeout(() => {
      socket.destroy()
      resolve()
    }, 300)
  })
  socket.on('error', () => {})
})
await new Promise((resolve) => setTimeout(resolve, 300))
server.close()

let passed = 0
const check = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

try {
  await check('the interrupted request never reaches a controller', () => {
    assert.equal(controllerRuns, 0)
  })

  await check("the photo that arrived whole is left behind, under the sweep's name", async () => {
    const left = await readdir(dir)
    assert.equal(left.length, 1, `left behind: ${JSON.stringify(left)}`)
    assert.ok(left[0].startsWith(UPLOAD_TMP_PREFIX))
  })

  await check(
    'a sweep right away leaves it: it may belong to an upload still in progress',
    async () => {
      assert.equal(await sweepStaleUploads(dir), 0)
      const left = await readdir(dir)
      assert.equal(left.length, 1)
    }
  )

  await check('a sweep long afterwards removes it', async () => {
    assert.equal(await sweepStaleUploads(dir, Date.now() + 7 * 60 * 60 * 1000), 1)
    assert.deepEqual(await readdir(dir), [])
  })
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${passed} checks passed`)
