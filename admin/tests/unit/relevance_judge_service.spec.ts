import { test } from '@japa/runner'
import { RelevanceJudgeService } from '../../app/services/relevance_judge_service.js'

const chunks = [
  {
    text: 'This guide covers water storage.',
    metadata: { full_title: 'Water Guide', source: '/private/path' },
  },
]

test.group('RelevanceJudgeService', () => {
  test('drops passages only for a valid off-topic verdict', async ({ assert }) => {
    let request: any
    const service = new RelevanceJudgeService(
      {
        chat: async (value: any) => {
          request = value
          return { message: { content: '{"on_topic":false}' }, structured: true }
        },
      } as any,
      null as any
    )

    assert.deepEqual(await service.judge('Write a poem', chunks, 'test:3b'), {
      kept: [],
      rejected: 1,
      judged: true,
    })
    assert.equal(request.options.num_predict, 32)
    assert.equal(request.options.temperature, 0)
    assert.equal(request.think, false)
    assert.notInclude(request.messages[1].content, '/private/path')
  })

  test('keeps passages when the model replies on-topic', async ({ assert }) => {
    const service = new RelevanceJudgeService(
      {
        chat: async () => ({ message: { content: '{"on_topic":true}' }, structured: false }),
      } as any,
      null as any
    )
    assert.deepEqual(await service.judge('How do I store water?', chunks, 'test:3b'), {
      kept: chunks,
      rejected: 0,
      judged: true,
    })
  })

  test('keeps passages when the verdict is malformed or the model fails', async ({ assert }) => {
    let shouldThrow = false
    const service = new RelevanceJudgeService(
      {
        chat: async () => {
          if (shouldThrow) throw new Error('model unavailable')
          return { message: { content: 'unknown' }, structured: false }
        },
      } as any,
      null as any
    )
    const unchanged = { kept: chunks, rejected: 0, judged: false }
    assert.deepEqual(await service.judge('Water?', chunks, 'test:3b'), unchanged)
    shouldThrow = true
    assert.deepEqual(await service.judge('Water?', chunks, 'test:3b'), unchanged)
  })
})
