import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadDrugJsonFactories } from '../../util/drug_json_stream.ts'

const factories = await loadDrugJsonFactories()

async function parseResults(chunks: string[]): Promise<unknown[]> {
  const records: unknown[] = []
  await pipeline(
    Readable.from(chunks),
    factories.parser({ jsonStreaming: false }),
    factories.pick({ filter: 'results' }),
    factories.streamArray(),
    new Writable({
      objectMode: true,
      write(chunk: { value: unknown }, _encoding, callback) {
        records.push(chunk.value)
        callback()
      },
    })
  )
  return records
}

const document =
  '{"meta":{"ignored":true},"results":[{"set_id":"first"},{"set_id":"second","nested":{"a":1}}]}'
const records = await parseResults([
  document.slice(0, 19),
  document.slice(19, 53),
  document.slice(53),
])
assert.deepEqual(records, [{ set_id: 'first' }, { set_id: 'second', nested: { a: 1 } }])
console.log('  ok - parsed every drug result across chunks and ignored the envelope')

await assert.rejects(parseResults(['{"results":[{"set_id":"broken"}']))
console.log('  ok - malformed JSON rejects the pipeline')

const [poisoned] = await parseResults([
  '{"results":[{"set_id":"safe","__proto__":{"polluted":true}}]}',
])
assert.equal((poisoned as { polluted?: boolean }).polluted, undefined)
assert.equal(({} as { polluted?: boolean }).polluted, undefined)
assert.equal(Object.hasOwn(poisoned as object, '__proto__'), true)
console.log('  ok - a __proto__ key remains data and does not alter the record prototype')
