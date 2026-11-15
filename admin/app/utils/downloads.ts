import type {
  DoResumableDownloadParams,
  DoResumableDownloadWithRetryParams,
} from '../../types/downloads.js'
import axios from 'axios'
import { lock } from 'proper-lockfile'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { deleteFileIfExists, ensureDirectoryExists, getFileStatsIfExists } from './fs.js'
import { assertNotPrivateUrl, assertSafeRedirectTarget } from '../validators/common.js'
import { downloadUrlOriginForLog } from './download_url_log.js'
import { contentLength, hasRoomForDownload, isMatchingResume } from './download_integrity.js'

export class GatedContentAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatedContentAuthError'
  }
}

export class InsufficientDiskSpaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsufficientDiskSpaceError'
  }
}

const DOWNLOAD_HEADERS = { 'User-Agent': 'ProjectNOMAD/1.0 (+https://projectnomad.us)' }

async function requireFreeSpace(dirname: string, remaining: number): Promise<void> {
  let stats
  try {
    stats = await fs.statfs(dirname)
  } catch (error) {
    // Some mounted filesystems cannot report free space. Writes still fail on ENOSPC.
    console.warn(`[Download] Cannot check free space (${(error as Error).name})`)
    return
  }
  const free = Number(stats.bavail) * Number(stats.bsize)
  if (!hasRoomForDownload(remaining, free)) {
    throw new InsufficientDiskSpaceError(
      'Not enough free disk space: the download must leave 2 GiB free. Free some space and retry.'
    )
  }
}

async function matchesHash(filepath: string, sha256?: string): Promise<boolean> {
  if (!sha256) return true
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filepath)) hash.update(chunk)
  return hash.digest('hex') === sha256
}

function rethrowAuth(error: any): never {
  const status = error?.response?.status
  if (status === 401 || status === 403) {
    throw new GatedContentAuthError(
      `This content is gated behind an entitlement key this install does not have. The download server rejected the request (HTTP ${status}). If you host this content yourself, set HOSTED_CONTENT_APP_KEY in the NOMAD env.`
    )
  }
  throw error
}

/** Stage and validate a download before publishing it over any installed file. */
export async function doResumableDownload(params: DoResumableDownloadParams): Promise<string> {
  const directory = path.dirname(params.filepath)
  await ensureDirectoryExists(directory)
  // Resolve directory aliases even before the destination exists.
  const destination = path.join(await fs.realpath(directory), path.basename(params.filepath))
  const compromised = new AbortController()
  const signal = params.signal
    ? AbortSignal.any([params.signal, compromised.signal])
    : compromised.signal
  // One owner through publication and completion, including separate worker processes.
  const release = await lock(destination, {
    realpath: false,
    stale: 30000,
    update: 10000,
    onCompromised: (error) => compromised.abort(error),
  })
  let failed = false
  try {
    return await downloadWhileLocked({ ...params, signal })
  } catch (error) {
    failed = true
    // Cleanup only while this transfer still owns the destination lock.
    if (params.signal?.reason === 'user-cancel' && !compromised.signal.aborted) {
      await deleteFileIfExists(destination + '.tmp')
      await deleteFileIfExists(destination + '.tmp.source')
    }
    throw error
  } finally {
    if (!failed) await release()
    else
      await release().catch((error) => {
        console.error(`[Download] Could not release destination lock (${(error as Error).name})`)
      })
  }
}

async function downloadWhileLocked({
  url,
  filepath,
  timeout = 30000,
  signal,
  onProgress,
  onComplete,
  forceNew = false,
  resumeCompletion = false,
  allowedMimeTypes,
  requestHeaders,
  expectedSize,
  expectedSha256,
  maxRedirects,
}: DoResumableDownloadParams): Promise<string> {
  assertNotPrivateUrl(url)
  signal?.throwIfAborted()
  if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new Error('Invalid expected SHA-256')
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize <= 0))
    throw new Error('Invalid expected download size')
  const dirname = path.dirname(filepath)
  await ensureDirectoryExists(dirname)
  const tempPath = filepath + '.tmp'
  const sourcePath = tempPath + '.source'
  const sourceIdentity = expectedSha256 ?? createHash('sha256').update(url).digest('hex')
  const baseHeaders = { ...DOWNLOAD_HEADERS, ...requestHeaders, 'Accept-Encoding': 'identity' }
  let head: Record<string, any> = {}
  // LFS signed GET URLs have a trusted pointer size and may not authorize HEAD.
  if (expectedSize === undefined) {
    try {
      const response = await axios.head(url, {
        signal,
        timeout,
        maxRedirects,
        headers: baseHeaders,
        beforeRedirect: assertSafeRedirectTarget,
      })
      head = response.headers
    } catch (error) {
      rethrowAuth(error)
    }
  }
  let totalBytes = expectedSize ?? contentLength(head['content-length'])
  if (
    expectedSize === undefined &&
    allowedMimeTypes?.length &&
    !allowedMimeTypes.some((mime) => String(head['content-type'] || '').includes(mime))
  ) {
    throw new Error('Download MIME type is not allowed')
  }
  const finalStats = await getFileStatsIfExists(filepath)
  if (
    !forceNew &&
    totalBytes > 0 &&
    Number(finalStats?.size) === totalBytes &&
    (await matchesHash(filepath, expectedSha256))
  ) {
    signal?.throwIfAborted()
    if (resumeCompletion) await onComplete?.(url, filepath)
    return filepath
  }
  const partial = await getFileStatsIfExists(tempPath)
  let storedIdentity: string | undefined
  try {
    storedIdentity = await fs.readFile(sourcePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // Legacy/unattributed partials are restarted; a filename alone is not provenance.
  let startByte =
    !forceNew && partial && storedIdentity === sourceIdentity ? Number(partial.size) : 0
  if (startByte === totalBytes && totalBytes > 0) {
    if (await matchesHash(tempPath, expectedSha256)) {
      signal?.throwIfAborted()
      await fs.rename(tempPath, filepath)
      await deleteFileIfExists(sourcePath)
      await onComplete?.(url, filepath)
      return filepath
    }
    startByte = 0
  }
  if (head['accept-ranges'] !== 'bytes' || (totalBytes > 0 && startByte > totalBytes)) startByte = 0
  if (!startByte && partial) await deleteFileIfExists(tempPath)
  await requireFreeSpace(dirname, Math.max(0, totalBytes - startByte))
  await fs.writeFile(sourcePath, sourceIdentity, { mode: 0o600 })
  const fetchStream = async (offset: number) => {
    try {
      return await axios.get(url, {
        responseType: 'stream',
        decompress: false,
        signal,
        timeout,
        maxRedirects,
        headers: { ...baseHeaders, ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}) },
        beforeRedirect: assertSafeRedirectTarget,
      })
    } catch (error) {
      rethrowAuth(error)
    }
  }
  let response = await fetchStream(startByte)
  if (
    startByte > 0 &&
    (response.status === 200 ||
      !isMatchingResume(response.headers?.['content-range'], startByte, totalBytes))
  ) {
    response.data.destroy()
    startByte = 0
    await deleteFileIfExists(tempPath)
    await requireFreeSpace(dirname, totalBytes)
    response = await fetchStream(0)
  }
  try {
    signal?.throwIfAborted()
    if (response.status !== 200 && response.status !== 206)
      throw new Error(`Failed to download: HTTP ${response.status}`)
    if (!startByte && response.status === 206)
      throw new Error('Download server returned a partial response without a range request')
    if (
      allowedMimeTypes?.length &&
      !allowedMimeTypes.some(
        (mime) =>
          String(response.headers?.['content-type'] || '')
            .split(';')[0]
            .trim() === mime
      )
    )
      throw new Error('Download MIME type is not allowed')
    const encoding = response.headers?.['content-encoding']
    if (encoding && encoding !== 'identity') throw new Error('Unexpected download content encoding')
    const responseBytes = contentLength(response.headers?.['content-length'])
    if (startByte > 0 && !totalBytes)
      totalBytes = Number(String(response.headers['content-range']).split('/')[1])
    if (responseBytes > 0) {
      if (totalBytes > 0 && startByte + responseBytes !== totalBytes)
        throw new Error('Download size changed between HEAD and GET')
      totalBytes = startByte + responseBytes
    }
    await requireFreeSpace(dirname, Math.max(0, totalBytes - startByte))
  } catch (error) {
    response.data.destroy()
    throw error
  }

  let downloadedBytes = startByte
  let lastProgressTime = 0
  let lastSpaceCheck = 0
  let lastSpaceBytes = startByte
  const stalled = new AbortController()
  const combined = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const resetStallTimer = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(
      () => stalled.abort(new Error('Download stalled - no data received for 5 minutes')),
      5 * 60 * 1000
    )
  }
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length
      resetStallTimer()
      const check = async () => {
        if (totalBytes > 0 && downloadedBytes > totalBytes)
          throw new Error(`Incomplete download: received more than ${totalBytes} bytes`)
        const now = Date.now()
        if (now - lastSpaceCheck >= 5000 || downloadedBytes - lastSpaceBytes >= 64 * 1024 ** 2) {
          await requireFreeSpace(dirname, Math.max(0, totalBytes - downloadedBytes + chunk.length))
          lastSpaceCheck = now
          lastSpaceBytes = downloadedBytes
        }
        if (onProgress && now - lastProgressTime >= 500) {
          lastProgressTime = now
          await onProgress({
            downloadedBytes,
            totalBytes,
            lastProgressTime: now,
            lastDownloadedBytes: downloadedBytes,
            url,
          })
        }
      }
      check().then(
        () => callback(null, chunk),
        (error) => callback(error)
      )
    },
  })
  resetStallTimer()
  try {
    await pipeline(
      response.data,
      progress,
      createWriteStream(tempPath, { flags: startByte > 0 ? 'a' : 'w' }),
      { signal: combined }
    )
  } finally {
    clearTimeout(stallTimer)
  }
  signal?.throwIfAborted()
  if (totalBytes > 0 && downloadedBytes !== totalBytes)
    throw new Error(`Incomplete download: received ${downloadedBytes} of ${totalBytes} bytes`)
  if (!(await matchesHash(tempPath, expectedSha256))) {
    await deleteFileIfExists(tempPath)
    throw new Error('Download SHA-256 mismatch')
  }
  signal?.throwIfAborted()
  // Concurrent jobs must not claim each other's output just because sizes match.
  await fs.rename(tempPath, filepath)
  await deleteFileIfExists(sourcePath)
  await onProgress?.({
    downloadedBytes,
    totalBytes,
    lastProgressTime: Date.now(),
    lastDownloadedBytes: downloadedBytes,
    url,
  })
  await onComplete?.(url, filepath)
  return filepath
}

export async function doResumableDownloadWithRetry({
  url,
  filepath,
  signal,
  timeout = 30000,
  onProgress,
  max_retries = 3,
  retry_delay = 2000,
  onAttemptError,
  allowedMimeTypes,
}: DoResumableDownloadWithRetryParams): Promise<string> {
  const dirname = path.dirname(filepath)
  await ensureDirectoryExists(dirname)

  let attempt = 0
  let lastError: Error | null = null

  while (attempt < max_retries) {
    try {
      const result = await doResumableDownload({
        url,
        filepath,
        signal,
        timeout,
        allowedMimeTypes,
        onProgress,
      })

      return result // return on success
    } catch (error: any) {
      attempt++
      lastError = error as Error

      const isAborted = error.name === 'AbortError' || error.code === 'ABORT_ERR'
      const isNetworkError =
        error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT'

      onAttemptError?.(error, attempt)
      if (isAborted) {
        throw new Error(`Download aborted from ${downloadUrlOriginForLog(url)}`)
      }

      if (attempt < max_retries && isNetworkError) {
        await delay(retry_delay)
        continue
      }

      // If max retries reached or non-retriable error, throw
      if (attempt >= max_retries || !isNetworkError) {
        throw error
      }
    }
  }

  // should not reach here, but TypeScript needs a return
  throw lastError || new Error('Unknown error during download')
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
