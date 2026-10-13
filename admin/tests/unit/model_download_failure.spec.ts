import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import { UnrecoverableError } from 'bullmq'
import { OllamaService } from '#services/ollama_service'
import { DownloadModelJob } from '#jobs/download_model_job'

test('model pull is not successful when Ollama ends the stream without installing it', async () => {
  const service = new OllamaService()
  const includeEmbeddings: boolean[] = []
  ;(service as any).ollama = {
    pull: async () =>
      (async function* () {
        yield { status: 'success' }
      })(),
  }
  ;(service as any).getModels = async (include = false) => {
    includeEmbeddings.push(include)
    return []
  }

  const result = await service.downloadModel('missing:1')
  assert.equal(result.success, false)
  assert.match(result.message, /not installed|did not complete/i)
  assert.deepEqual(includeEmbeddings, [true, true])
})

test('model pull accepts a bare embedding name after it appears as latest', async () => {
  const service = new OllamaService()
  const includeEmbeddings: boolean[] = []
  ;(service as any).ollama = {
    pull: async () =>
      (async function* () {
        yield { status: 'success' }
      })(),
  }
  ;(service as any).getModels = async (include = false) => {
    includeEmbeddings.push(include)
    return includeEmbeddings.length === 2 ? [{ name: 'nomic-embed-text:latest' }] : []
  }

  const result = await service.downloadModel('nomic-embed-text')
  assert.equal(result.success, true)
  assert.deepEqual(includeEmbeddings, [true, true])
})

test('a missing model is a permanent pull error', async () => {
  const service = new OllamaService()
  ;(service as any).ollama = {
    pull: async () =>
      (async function* () {
        throw new Error('pull model manifest: file does not exist')
      })(),
  }
  ;(service as any).getModels = async () => []

  const result = await service.downloadModel('missing:1')
  assert.equal(result.success, false)
  assert.equal(result.retryable, false)
  assert.match(result.message, /file does not exist/i)
})

test('a connection failure can still retry', async () => {
  const service = new OllamaService()
  ;(service as any).ollama = {
    pull: async () =>
      (async function* () {
        throw new Error('ECONNRESET while pulling')
      })(),
  }
  ;(service as any).getModels = async () => []

  const result = await service.downloadModel('example:1')
  assert.equal(result.success, false)
  assert.equal(result.retryable, true)
})

test('the model download job does not retry a known missing model', async () => {
  const originalGetModels = OllamaService.prototype.getModels
  const originalDownloadModel = OllamaService.prototype.downloadModel
  OllamaService.prototype.getModels = async () => []
  OllamaService.prototype.downloadModel = async () => ({
    success: false,
    message: 'Model does not exist',
    retryable: false,
  })

  try {
    const job = { data: { modelName: 'missing:1' } } as any
    await assert.rejects(new DownloadModelJob().handle(job), UnrecoverableError)
  } finally {
    OllamaService.prototype.getModels = originalGetModels
    OllamaService.prototype.downloadModel = originalDownloadModel
  }
})
