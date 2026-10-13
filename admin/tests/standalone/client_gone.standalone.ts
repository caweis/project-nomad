/**
 * Noticing that a reader left while the server was busy, for real: a real HTTP
 * server, and a client that closes its socket part-way through. It also records
 * why the check is needed: a listener attached after the client left never hears
 * about it.
 *
 * Run: node --experimental-strip-types tests/standalone/client_gone.standalone.ts
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { clientHasLeft } from '../../app/utils/client_gone.ts'

let passed = 0
const check = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

await check('a response that is not destroyed has not left', () => {
  assert.equal(clientHasLeft({ destroyed: false, socket: { destroyed: false } }), false)
  assert.equal(clientHasLeft({}), false)
  assert.equal(clientHasLeft({ socket: null }), false)
})

await check('a destroyed response, or a destroyed socket, has left', () => {
  assert.equal(clientHasLeft({ destroyed: true }), true)
  assert.equal(clientHasLeft({ destroyed: false, socket: { destroyed: true } }), true)
})

await check(
  'a real client that closes its socket part-way is seen to have left, and a late close listener is not told',
  async () => {
    const seen: { before?: boolean; after?: boolean; lateListenerFired?: boolean } = {}
    let done: () => void = () => {}
    const finished = new Promise<void>((resolve) => (done = resolve))
    const server = http.createServer(async (_req, res) => {
      seen.before = clientHasLeft(res)
      await wait(300) // the pictures are being resized
      seen.after = clientHasLeft(res)
      seen.lateListenerFired = false
      res.on('close', () => (seen.lateListenerFired = true))
      await wait(100)
      done()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('POST /chat HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n')
      setTimeout(() => socket.destroy(), 100) // the reader presses Stop
    })
    socket.on('error', () => {})
    await finished
    server.close()
    assert.equal(seen.before, false, 'still there when the request arrived')
    assert.equal(seen.after, true, 'gone by the time the server had finished its work')
    assert.equal(seen.lateListenerFired, false, 'a listener attached now would never be told')
  }
)

console.log(`\n${passed} checks passed`)
