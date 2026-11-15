// Recovery pattern adapted from BigMoonTech/project-nomad-wsl (40d510bf).
import axios from 'axios'
import type { DoResumableDownloadParams } from '../../types/downloads.js'
import { doResumableDownload, GatedContentAuthError } from './downloads.js'

const repo = 'Crosstalk-Solutions/project-nomad-maps'
const mapUrl =
  /^https:\/\/github\.com\/Crosstalk-Solutions\/project-nomad-maps\/raw\/(?:refs\/heads\/)?master\/pmtiles\/([a-zA-Z0-9_-]+\.pmtiles)$/
const transportErrors = new Set([
  'EPROTO',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
])
const lfsMediaType = 'application/vnd.git-lfs+json'

export async function regionalMapPointerAfterError(
  url: string,
  error: unknown,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const filename = mapUrl.exec(url)?.[1]
  if (!filename || !transportErrors.has((error as NodeJS.ErrnoException)?.code ?? '')) throw error
  const { data } = await axios.get<string>(
    `https://raw.githubusercontent.com/${repo}/master/pmtiles/${filename}`,
    {
      responseType: 'text',
      maxRedirects: 0,
      maxContentLength: 1024,
      timeout: 15000,
      signal,
    }
  )
  const match =
    /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize ([0-9]+)$/.exec(
      String(data).trim()
    )
  const size = Number(match?.[2])
  if (!match || !Number.isSafeInteger(size) || size <= 0)
    throw new Error('Invalid upstream map LFS pointer')
  return { oid: match[1], size }
}

async function getDownloadUrl(pointer: { oid: string; size: number }, signal?: AbortSignal) {
  const { data } = await axios.post(
    `https://github.com/${repo}.git/info/lfs/objects/batch`,
    {
      operation: 'download',
      transfers: ['basic'],
      objects: [pointer],
    },
    {
      headers: { 'Accept': lfsMediaType, 'Content-Type': lfsMediaType },
      timeout: 15000,
      maxRedirects: 0,
      maxContentLength: 65536,
      signal,
    }
  )
  const object = data?.objects?.[0]
  if (
    object?.oid !== pointer.oid ||
    object.size !== pointer.size ||
    !object.actions?.download?.href
  ) {
    throw new Error('GitHub LFS did not return the requested map object')
  }
  const url = new URL(object.actions.download.href)
  if (url.origin !== 'https://github-cloud.githubusercontent.com' || url.username || url.password) {
    throw new Error('Unexpected GitHub LFS map download host')
  }
  return url.href
}

export async function downloadRegionalMap(params: DoResumableDownloadParams): Promise<string> {
  let pointer
  let completionStarted = false
  try {
    return await doResumableDownload({
      ...params,
      onComplete: async (...args) => {
        completionStarted = true
        await params.onComplete?.(...args)
      },
    })
  } catch (error) {
    // A post-download error must retry completion, not switch download sources.
    if (completionStarted || (params.requestHeaders && Object.keys(params.requestHeaders).length))
      throw error
    pointer = await regionalMapPointerAfterError(params.url, error, params.signal)
  }
  const signedUrl = await getDownloadUrl(pointer, params.signal)
  params.signal?.throwIfAborted()
  try {
    return await doResumableDownload({
      ...params,
      url: signedUrl,
      requestHeaders: undefined,
      maxRedirects: 0,
      expectedSize: pointer.size,
      expectedSha256: pointer.oid,
      onProgress: (progress) => params.onProgress?.({ ...progress, url: params.url }),
      onComplete: () => params.onComplete?.(params.url, params.filepath),
    })
  } catch (error) {
    if (error instanceof GatedContentAuthError)
      throw new Error('GitHub rejected its temporary LFS download URL; retry to request a new one')
    throw error
  }
}
