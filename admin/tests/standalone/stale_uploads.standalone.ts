/**
 * Clearing out abandoned upload files from the temp folder: only files the
 * upload parser named, only once nothing has written to them for a long time,
 * and never anything else in the folder.
 *
 * Run: node --experimental-strip-types tests/standalone/stale_uploads.standalone.ts
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  STALE_UPLOAD_MAX_AGE_MS,
  UPLOAD_TMP_PREFIX,
  isStaleUpload,
  sweepStaleUploads,
} from '../../app/utils/stale_uploads.ts'

let passed = 0
const check = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0)

await check('the prefix and the age are what the parser config and the docs say', () => {
  assert.equal(UPLOAD_TMP_PREFIX, 'nomad-upload-')
  assert.equal(STALE_UPLOAD_MAX_AGE_MS, 6 * HOUR)
})

await check('a recognisable name untouched for the full age is abandoned', () => {
  assert.equal(isStaleUpload('nomad-upload-abc', NOW - 6 * HOUR, NOW), true)
  assert.equal(isStaleUpload('nomad-upload-abc', NOW - 30 * HOUR, NOW), true)
})

await check('a file still being written to, or just finished, is not', () => {
  assert.equal(isStaleUpload('nomad-upload-abc', NOW, NOW), false)
  assert.equal(isStaleUpload('nomad-upload-abc', NOW - 6 * HOUR + 1, NOW), false)
})

await check('a file that is not ours is never abandoned, however old', () => {
  assert.equal(isStaleUpload('cd5k2l9x', NOW - 400 * HOUR, NOW), false)
  assert.equal(isStaleUpload('not-nomad-upload-abc', NOW - 400 * HOUR, NOW), false)
})

await check('the sweep removes old upload files and leaves everything else', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-check-'))
  try {
    const old = new Date(NOW - 7 * HOUR)
    const recent = new Date(NOW - 1 * HOUR)
    const make = async (name: string, when: Date) => {
      await writeFile(join(dir, name), 'x')
      await utimes(join(dir, name), when, when)
    }
    await make('nomad-upload-old-1', old)
    await make('nomad-upload-old-2', old)
    await make('nomad-upload-recent', recent) // still within the age
    await make('unrelated-old-file', old) // not ours
    await mkdir(join(dir, 'nomad-upload-a-folder')) // not a file
    await utimes(join(dir, 'nomad-upload-a-folder'), old, old)

    const removed = await sweepStaleUploads(dir, NOW)
    assert.equal(removed, 2)
    const left = await readdir(dir)
    assert.deepEqual(left.sort(), [
      'nomad-upload-a-folder',
      'nomad-upload-recent',
      'unrelated-old-file',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await check('a second pass has nothing left to remove', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-check-'))
  try {
    const old = new Date(NOW - 8 * HOUR)
    await writeFile(join(dir, 'nomad-upload-x'), 'x')
    await utimes(join(dir, 'nomad-upload-x'), old, old)
    assert.equal(await sweepStaleUploads(dir, NOW), 1)
    assert.equal(await sweepStaleUploads(dir, NOW), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await check('a folder that is not there is not an error', async () => {
  assert.equal(await sweepStaleUploads(join(tmpdir(), 'no-such-folder-for-sweep-check'), NOW), 0)
})

await check('the age can be given, for a shorter or a longer wait', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-check-'))
  try {
    const when = new Date(NOW - 2 * HOUR)
    await writeFile(join(dir, 'nomad-upload-y'), 'x')
    await utimes(join(dir, 'nomad-upload-y'), when, when)
    assert.equal(await sweepStaleUploads(dir, NOW, 3 * HOUR), 0)
    assert.equal(await sweepStaleUploads(dir, NOW, 1 * HOUR), 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

console.log(`\n${passed} checks passed`)
