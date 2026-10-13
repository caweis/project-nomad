import { test } from '@japa/runner'
import { OllamaService } from '../../app/services/ollama_service.js'
import env from '#start/env'
import {
  QUERIES_SCHEMA,
  SUGGESTIONS_SCHEMA,
  TITLE_SCHEMA,
  parseStructured,
  pickQueries,
  pickSuggestions,
  pickTitle,
  resolveStructured,
  shouldConstrainStructuredOutput,
} from '../../app/utils/structured_output.js'

test.group('structured task output', () => {
  test('schemas require the expected keys', ({ assert }) => {
    assert.deepEqual(TITLE_SCHEMA.required, ['title'])
    assert.deepEqual(SUGGESTIONS_SCHEMA.required, ['suggestions'])
    assert.deepEqual(QUERIES_SCHEMA.required, ['queries'])
    assert.equal(SUGGESTIONS_SCHEMA.properties.suggestions.minItems, 3)
    assert.equal(SUGGESTIONS_SCHEMA.properties.suggestions.maxItems, 3)
    assert.isFalse(TITLE_SCHEMA.additionalProperties)
  })

  test('parses fenced JSON and trims a title', ({ assert }) => {
    assert.equal(
      parseStructured('```json\n{"title":" Water storage "}\n```', pickTitle),
      'Water storage'
    )
  })

  test('keeps only nonempty string suggestions and the first three', ({ assert }) => {
    assert.deepEqual(
      parseStructured('{"suggestions":[" A ",null,"B"," ","C","D"]}', pickSuggestions),
      ['A', 'B', 'C']
    )
  })

  test('drops blank queries before retrieval selects the first', ({ assert }) => {
    assert.deepEqual(parseStructured('{"queries":[" ","real query"]}', pickQueries), ['real query'])
  })

  test('malformed output preserves the reason for the caller fallback', ({ assert }) => {
    assert.deepEqual(resolveStructured('{"title":"unfinished', pickTitle, true), {
      ok: false,
      reason: 'constrained-parse-failed',
    })
    assert.deepEqual(resolveStructured('Plain title', pickTitle, false), {
      ok: false,
      reason: 'unconstrained',
    })
  })

  test('bad types and a throwing picker cannot enter the chat path', ({ assert }) => {
    assert.isNull(parseStructured('{"title":42}', pickTitle))
    assert.isNull(
      parseStructured('{"title":"A"}', () => {
        throw new Error('bad picker')
      })
    )
  })

  test('omits schemas on oMLX but allows native Ollama', ({ assert }) => {
    assert.isFalse(shouldConstrainStructuredOutput('omlx', TITLE_SCHEMA))
    assert.isTrue(shouldConstrainStructuredOutput('ollama', TITLE_SCHEMA))
    assert.isTrue(shouldConstrainStructuredOutput(undefined, TITLE_SCHEMA))
    assert.isFalse(shouldConstrainStructuredOutput('ollama', undefined))
  })
})

test('native ancillary chat forwards the schema and marks the response constrained', async ({
  assert,
}) => {
  const service = new OllamaService()
  let forwarded: any
  ;(service as any)._ensureDependencies = async () => {}
  ;(service as any).ollama = {
    chat: async (request: any) => {
      forwarded = request
      return { message: { content: '{"title":"Water"}' }, done: true, model: request.model }
    },
  }

  const response = await service.chat({
    model: 'test:latest',
    messages: [{ role: 'user', content: 'title' }],
    format: TITLE_SCHEMA,
  })

  assert.deepEqual(forwarded.format, TITLE_SCHEMA)
  assert.isTrue((response as any).structured)
})

test('Mac oMLX ancillary chat omits the unsupported schema', async ({ assert }) => {
  const originalGet = env.get
  ;(env as any).get = (key: string) => (key === 'NOMAD_AI_BACKEND' ? 'omlx' : undefined)
  const service = new OllamaService()
  let forwarded: any
  ;(service as any)._ensureDependencies = async () => {}
  ;(service as any).ollama = {
    chat: async (request: any) => {
      forwarded = request
      return { message: { content: 'Water storage' }, done: true, model: request.model }
    },
  }

  try {
    const response = await service.chat({
      model: 'test:latest',
      messages: [{ role: 'user', content: 'title' }],
      format: TITLE_SCHEMA,
    })

    assert.notProperty(forwarded, 'format')
    assert.isFalse(response.structured)
  } finally {
    ;(env as any).get = originalGet
  }
})
