import { test } from '@japa/runner'
import KVStore from '../../app/models/kv_store.js'
import { ChatService } from '../../app/services/chat_service.js'
import OllamaController from '../../app/controllers/ollama_controller.js'
import {
  QUERIES_SCHEMA,
  SUGGESTIONS_SCHEMA,
  TITLE_SCHEMA,
} from '../../app/utils/structured_output.js'

test.group('structured ancillary calls', () => {
  test('stores a parsed title and caps the length of model output', async ({ assert }) => {
    let request: any
    let savedTitle: string | undefined
    const service = new ChatService({
      chat: async (value: any) => {
        request = value
        return { message: { content: JSON.stringify({ title: 'A'.repeat(80) }) }, structured: true }
      },
    } as any)
    service.resolveTasksModel = async (fallback) => fallback
    service.updateSession = async (_id, data) => {
      savedTitle = data.title
      return { id: '7', title: savedTitle ?? '', model: null, timestamp: new Date() }
    }

    await service.generateTitle(7, 'Water storage', 'Store it safely', 'test:latest')

    assert.deepEqual(request.format, TITLE_SCHEMA)
    assert.equal(request.options.temperature, 0)
    assert.equal(savedTitle, `${'A'.repeat(57)}...`)
  })

  test('uses the user question when native title JSON is cut off', async ({ assert }) => {
    let savedTitle: string | undefined
    const service = new ChatService({
      chat: async () => ({ message: { content: '{"title":"unfinished' }, structured: true }),
    } as any)
    service.resolveTasksModel = async (fallback) => fallback
    service.updateSession = async (_id, data) => {
      savedTitle = data.title
      return { id: '7', title: savedTitle ?? '', model: null, timestamp: new Date() }
    }

    await service.generateTitle(7, 'How do I store water?', '', 'test:latest')

    assert.equal(savedTitle, 'How do I store water?')
  })

  test('parses JSON suggestions and retains legacy Mac text replies', async ({ assert }) => {
    const originalGetValue = KVStore.getValue
    ;(KVStore as any).getValue = async () => null
    let content = '{"suggestions":["store water?","pack a kit?","find shelter?"]}'
    let constrained = true
    let request: any
    const service = new ChatService({
      getModels: async () => [{ name: 'test:1b', size: 1_000_000 }],
      chat: async (value: any) => {
        request = value
        return { message: { content }, structured: constrained }
      },
    } as any)
    service.resolveTasksModel = async (fallback) => fallback

    try {
      assert.deepEqual(await service.getChatSuggestions(), [
        'Store Water?',
        'Pack A Kit?',
        'Find Shelter?',
      ])
      assert.deepEqual(request.format, SUGGESTIONS_SCHEMA)
      content = 'store water?, pack a kit?, find shelter?'
      constrained = false
      assert.deepEqual(await service.getChatSuggestions(), [
        'Store Water?',
        'Pack A Kit?',
        'Find Shelter?',
      ])
      content = '{"suggestions":["unfinished'
      assert.deepEqual(await service.getChatSuggestions(), [])
    } finally {
      ;(KVStore as any).getValue = originalGetValue
    }
  })

  test('selects the first parsed query and protects retrieval from JSON fragments', async ({
    assert,
  }) => {
    let content = '{"queries":["How long does cured meat last?","other"]}'
    let constrained = true
    let request: any
    const controller = new OllamaController(
      { resolveTasksModel: async (fallback: string) => fallback } as any,
      {
        chat: async (value: any) => {
          request = value
          return { message: { content }, structured: constrained }
        },
      } as any,
      { hasDocuments: async () => true } as any,
      null as any,
      null as any
    )
    const messages = [
      { role: 'user', content: 'How do I cure meat?' },
      { role: 'assistant', content: 'Use salt.' },
      { role: 'user', content: 'What about smoking?' },
      { role: 'assistant', content: 'Smoking can help.' },
      { role: 'user', content: 'How long does it last?' },
    ]
    const rewrite = () => (controller as any).rewriteQueryWithContext(messages, 'test:latest')

    assert.equal(await rewrite(), 'How long does cured meat last?')
    assert.deepEqual(request.format, QUERIES_SCHEMA)
    assert.equal(request.options.num_predict, 160)
    content = '{"queries":["unfinished'
    assert.equal(await rewrite(), 'How long does it last?')
    content = 'smoked meat storage duration'
    constrained = false
    assert.equal(await rewrite(), 'smoked meat storage duration')
    content = '{"queries":["unfinished'
    assert.equal(await rewrite(), 'How long does it last?')
  })
})
