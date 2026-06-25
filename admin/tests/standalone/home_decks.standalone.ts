/**
 * Standalone gate test for the home scenario-deck taxonomy + grouping util.
 *
 * Japa cannot boot locally without MySQL/Redis, so this file exercises the pure
 * deck helpers (DECKS, deckForKey, isPinned, groupIntoDecks) directly under
 * `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/home_decks.standalone.ts
 */
import assert from 'node:assert/strict'
import { DECKS, deckForKey, isPinned, groupIntoDecks } from '../../inertia/util/home_decks.ts'
let p = 0; const check = (n: string, f: () => void) => { f(); p++; console.log(`  ok - ${n}`) }

check('deck order, secure-ai first', () => {
  assert.deepEqual(DECKS.map(d => d.key), ['secure-ai','communicate','knowledge-maps','health-supplies','tools-workshop'])
})
check('deckForKey maps known + falls back', () => {
  assert.equal(deckForKey('nomad_vaultwarden'), 'secure-ai')
  assert.equal(deckForKey('ai-assistant'), 'secure-ai')
  assert.equal(deckForKey('maps'), 'knowledge-maps')
  assert.equal(deckForKey('totally-unknown'), 'tools-workshop')
})
check('isPinned uses display_order <= 8', () => {
  assert.equal(isPinned({ displayOrder: 8 } as any), true)
  assert.equal(isPinned({ displayOrder: 9 } as any), false)
})
check('groupIntoDecks: order, pinned-only, hides empty', () => {
  const items = [
    { deckKey: 'maps', displayOrder: 4 },           // knowledge-maps, pinned
    { deckKey: 'nomad_flatnotes', displayOrder: 10 },// tools, NOT pinned
    { deckKey: 'nomad_vaultwarden', displayOrder: 8 },// secure-ai, pinned
  ]
  const decks = groupIntoDecks(items as any)
  assert.deepEqual(decks.map(d => d.deck.key), ['secure-ai','knowledge-maps']) // communicate/health/tools empty -> hidden
  assert.equal(decks[0].items.length, 1)
})
console.log(`\n${p} checks passed`)
