import assert from 'node:assert/strict'
import {
  buildJudgeInput,
  excerptFor,
  isRelevanceCheckEnabled,
  pickOnTopic,
} from '../../app/utils/relevance_judge.ts'

assert.equal(isRelevanceCheckEnabled(null), false)
assert.equal(isRelevanceCheckEnabled('false'), false)
assert.equal(isRelevanceCheckEnabled('true'), true)
assert.equal(pickOnTopic({ on_topic: false }), false)
assert.equal(pickOnTopic({ on_topic: 'false' }), null)

const longPassage = `${'Unrelated text. '.repeat(130)}Evacuation routes close at dusk.`
const excerpt = excerptFor(longPassage, 'When do evacuation routes close?', 180)
assert.ok(excerpt.includes('Evacuation routes close at dusk.'))
assert.ok(excerpt.length <= 182)

const prompt = buildJudgeInput('  When do routes close?  ', [
  { text: 'Routes close at dusk.', title: 'Evacuation Guide' },
])
assert.ok(prompt.startsWith('Question: When do routes close?'))
assert.ok(prompt.includes('p1 (from "Evacuation Guide")'))
assert.ok(!prompt.includes('/Users/'))

console.log('relevance_judge: 10 passed')
