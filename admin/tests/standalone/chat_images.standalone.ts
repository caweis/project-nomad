/**
 * Standalone checks for images attached to a chat message (upstream edbfe1ad):
 * what the server accepts, what it turns an upload into, and how the result is
 * handed to the model.
 *
 *   node --experimental-strip-types tests/standalone/chat_images.standalone.ts
 *
 * These decode real images with sharp rather than mocking it, because the
 * things worth proving are properties of the pixels: upright, shrunk, flattened
 * onto white, JPEG. The limits are passed in, so each boundary is hit with a
 * picture a few dozen pixels wide.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import {
  attachImagesToLatestUserMessage,
  ChatImageError,
  normalizeChatImages,
} from '../../app/utils/chat_images.ts'
import { CHAT_IMAGE_LIMITS, type ChatImageLimits } from '../../constants/chat_images.ts'
import { readMultipartChatPayload } from '../../app/utils/chat_multipart.ts'

let passed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

const LIMITS: ChatImageLimits = {
  maxImages: 4,
  maxBytes: 8 * 1024 * 1024,
  maxPixels: 40_000_000,
  maxDimension: 64,
  maxNormalizedBytes: 4 * 1024 * 1024,
}

const dir = await mkdtemp(join(tmpdir(), 'nomad-chat-images-'))
let n = 0
const tmp = (ext: string) => join(dir, `img-${n++}.${ext}`)

/** The shape normalizeChatImages reads from an uploaded file. */
function upload(over: Record<string, unknown> = {}): MultipartFile {
  return {
    tmpPath: undefined,
    size: 1000,
    isValid: true,
    errors: [],
    clientName: 'photo.png',
    ...over,
  } as unknown as MultipartFile
}

async function pngFile(width: number, height: number, alpha = 1, name = 'photo.png') {
  const path = tmp('png')
  await sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 20, b: 20, alpha } },
  })
    .png()
    .toFile(path)
  return upload({ tmpPath: path, clientName: name })
}

async function refused(promise: Promise<unknown>, status: number, message: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ChatImageError, `expected a ChatImageError, got ${error}`)
    assert.equal(error.status, status)
    assert.match(error.message, message)
    return true
  })
}

const decode = (base64: string) => Buffer.from(base64, 'base64')

try {
  // ── What an upload becomes ──
  await check('a PNG becomes a JPEG, handed over as bare base64 under its own name', async () => {
    const [image] = await normalizeChatImages([await pngFile(32, 32, 1, 'plant.png')], LIMITS)
    assert.equal(image.name, 'plant.png')
    assert.ok(!image.base64.startsWith('data:'), 'Ollama wants base64 alone, not a data: URL')
    const bytes = decode(image.base64)
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG signature')
    const { format } = await sharp(bytes).metadata()
    assert.equal(format, 'jpeg')
  })

  await check('a large image is shrunk to fit, keeping its proportions', async () => {
    const [image] = await normalizeChatImages([await pngFile(300, 150)], LIMITS)
    const { width, height } = await sharp(decode(image.base64)).metadata()
    assert.equal(width, LIMITS.maxDimension)
    assert.equal(height, LIMITS.maxDimension / 2)
  })

  await check('a small image is never enlarged', async () => {
    const [image] = await normalizeChatImages([await pngFile(20, 10)], LIMITS)
    const { width, height } = await sharp(decode(image.base64)).metadata()
    assert.deepEqual([width, height], [20, 10])
  })

  await check('transparency becomes white, not black', async () => {
    const [image] = await normalizeChatImages([await pngFile(16, 16, 0)], LIMITS)
    const { data } = await sharp(decode(image.base64)).raw().toBuffer({ resolveWithObject: true })
    assert.ok(
      data[0] >= 250 && data[1] >= 250 && data[2] >= 250,
      `got rgb ${data[0]},${data[1]},${data[2]}`
    )
  })

  await check('a photo taken sideways is turned upright from its EXIF orientation', async () => {
    const path = tmp('jpg')
    await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 120, b: 10 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(path)
    const [image] = await normalizeChatImages(
      [upload({ tmpPath: path, clientName: 'sideways.jpg' })],
      LIMITS
    )
    const { width, height, orientation } = await sharp(decode(image.base64)).metadata()
    assert.deepEqual([width, height], [20, 40])
    assert.equal(
      orientation,
      undefined,
      'the orientation flag is gone with the rest of the metadata'
    )
  })

  await check('location and camera metadata do not survive', async () => {
    const path = tmp('jpg')
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withExif({ IFD0: { Make: 'SecretCam', Software: 'tracker' } })
      .toFile(path)
    const [image] = await normalizeChatImages([upload({ tmpPath: path })], LIMITS)
    const bytes = decode(image.base64)
    assert.ok(!bytes.includes('SecretCam'), 'camera make leaked into what the model receives')
    const { exif } = await sharp(bytes).metadata()
    assert.equal(exif, undefined)
  })

  await check('several images come back in the order they were attached', async () => {
    const files = [await pngFile(10, 10, 1, 'a.png'), await pngFile(10, 10, 1, 'b.png')]
    const images = await normalizeChatImages(files, LIMITS)
    assert.deepEqual(
      images.map((i) => i.name),
      ['a.png', 'b.png']
    )
  })

  await check(
    'exactly the allowed number of images, each exactly at the size limit, is accepted',
    async () => {
      const files = await Promise.all(
        Array.from({ length: LIMITS.maxImages }, async (_, i) => {
          const file = await pngFile(10, 10, 1, `p${i}.png`)
          ;(file as unknown as { size: number }).size = LIMITS.maxBytes
          return file
        })
      )
      const images = await normalizeChatImages(files, LIMITS)
      assert.equal(images.length, LIMITS.maxImages)
    }
  )

  // ── What is refused, and with which status ──
  await check('more images than the limit are refused before any is decoded', async () => {
    const files = Array.from({ length: LIMITS.maxImages + 1 }, () => upload())
    await refused(normalizeChatImages(files, LIMITS), 422, /no more than 4 images/)
  })

  await check('a file larger than the per-image limit is refused as too large', async () => {
    const file = await pngFile(10, 10, 1, 'huge.png')
    ;(file as unknown as { size: number }).size = LIMITS.maxBytes + 1
    await refused(normalizeChatImages([file], LIMITS), 413, /"huge\.png" exceeds the 8 MB/)
  })

  await check("the upload parser's own reason is reported, not a generic refusal", async () => {
    const wrongType = upload({
      tmpPath: tmp('gif'),
      clientName: 'anim.gif',
      isValid: false,
      errors: [{ type: 'extname', message: 'Invalid file extension gif' }],
    })
    await refused(normalizeChatImages([wrongType], LIMITS), 415, /"anim\.gif" is not supported/)

    const tooBig = upload({
      tmpPath: tmp('png'),
      clientName: 'big.png',
      isValid: false,
      errors: [{ type: 'size', message: 'File size should be less than 8MB' }],
    })
    await refused(normalizeChatImages([tooBig], LIMITS), 413, /"big\.png" exceeds/)

    const other = upload({ tmpPath: tmp('png'), isValid: false, errors: [] })
    await refused(normalizeChatImages([other], LIMITS), 422, /not a valid image upload/)
  })

  await check('a file the parser never wrote to disk is refused', async () => {
    await refused(
      normalizeChatImages([upload({ clientName: 'lost.png' })], LIMITS),
      422,
      /Could not process "lost\.png"/
    )
  })

  await check('a format that is not JPEG, PNG or WebP is refused as unsupported', async () => {
    const path = tmp('gif')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .gif()
      .toFile(path)
    await refused(
      normalizeChatImages([upload({ tmpPath: path, clientName: 'still.gif' })], LIMITS),
      415,
      /Use JPEG, PNG, or WebP/
    )
  })

  await check('an animated image is refused, and named', async () => {
    const frame = (i: number) =>
      sharp({
        create: { width: 16, height: 10, channels: 3, background: { r: i * 80, g: 0, b: 0 } },
      })
        .png()
        .toBuffer()
    const animated = await sharp([await frame(0), await frame(1), await frame(2)], {
      join: { animated: true },
    })
      .webp({ loop: 0, delay: [100, 100, 100] })
      .toBuffer()
    const path = tmp('webp')
    await writeFile(path, animated)
    await refused(
      normalizeChatImages([upload({ tmpPath: path, clientName: 'spin.webp' })], LIMITS),
      415,
      /"spin\.webp" is animated/
    )
  })

  await check('something that is not an image at all cannot be decoded', async () => {
    const path = tmp('png')
    await writeFile(path, Buffer.from('this is a text file renamed to .png'))
    await refused(
      normalizeChatImages([upload({ tmpPath: path, clientName: 'notes.png' })], LIMITS),
      422,
      /"notes\.png" could not be decoded/
    )
  })

  await check(
    'a picture with too many pixels is refused rather than decoded, and the limit is named',
    async () => {
      // 1.2 megapixels against a 1 megapixel limit: small on disk, large once opened.
      const file = await pngFile(1200, 1000)
      await refused(
        normalizeChatImages([file], { ...LIMITS, maxPixels: 1_000_000 }),
        422,
        /"photo\.png" is larger than 1 megapixel, the most NOMAD will open/
      )
    }
  )

  await check(
    'the pixel limit is named in megapixels, and in the plural when it is not one',
    async () => {
      const file = await pngFile(2000, 1000)
      await refused(
        normalizeChatImages([file], { ...LIMITS, maxPixels: 1_500_000 }),
        422,
        /larger than 1\.5 megapixels, the most NOMAD will open/
      )
    }
  )

  await check(
    'an image that is still too large after shrinking is refused as too large',
    async () => {
      const file = await pngFile(60, 60)
      await refused(
        normalizeChatImages([file], { ...LIMITS, maxNormalizedBytes: 50 }),
        413,
        /remains too large after image processing/
      )
    }
  )

  await check('the limits the app ships are the ones upstream chose', () => {
    assert.deepEqual(CHAT_IMAGE_LIMITS, {
      maxImages: 4,
      maxBytes: 8 * 1024 * 1024,
      maxPixels: 40_000_000,
      maxDimension: 2048,
      maxNormalizedBytes: 4 * 1024 * 1024,
    })
  })

  // ── Handing them to the model ──
  const one = { name: 'a.png', base64: 'AAAA' }
  const two = { name: 'b.png', base64: 'BBBB' }

  await check('images ride on the newest user message and nothing else', () => {
    const messages = [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'what is this plant?' },
    ]
    const out = attachImagesToLatestUserMessage(messages, [one, two])
    assert.deepEqual(out[3], {
      role: 'user',
      content: 'what is this plant?',
      images: ['AAAA', 'BBBB'],
    })
    assert.equal(out[0], messages[0], 'untouched messages are the same objects')
    assert.equal(out[1], messages[1])
    assert.equal(out[2], messages[2])
    assert.equal('images' in messages[3], false, "the caller's own message is not mutated")
  })

  await check('with no images the messages come back exactly as they were', () => {
    const messages = [{ role: 'user', content: 'hi' }]
    assert.equal(attachImagesToLatestUserMessage(messages, []), messages)
  })

  await check('images with no user message to carry them are refused', () => {
    assert.throws(
      () => attachImagesToLatestUserMessage([{ role: 'system', content: 'x' }], [one]),
      (error: unknown) => error instanceof ChatImageError && error.status === 422
    )
  })

  // ── The multipart envelope ──
  await check('a multipart chat carries its request as a JSON payload field', () => {
    assert.deepEqual(readMultipartChatPayload('{"model":"gemma3","collection":"medical"}'), {
      ok: true,
      payload: { model: 'gemma3', collection: 'medical' },
    })
  })

  await check('a missing or malformed payload is refused with a reason', () => {
    for (const raw of [undefined, null, 42, { model: 'x' }]) {
      const result = readMultipartChatPayload(raw)
      assert.equal(result.ok, false, JSON.stringify(raw))
      assert.match((result as { message: string }).message, /require a JSON payload/)
    }
    const broken = readMultipartChatPayload('{"model":')
    assert.equal(broken.ok, false)
    assert.match((broken as { message: string }).message, /not valid JSON/)
  })
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${passed} checks passed`)
