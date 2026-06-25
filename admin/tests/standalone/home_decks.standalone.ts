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
check('isPinned: explicit false override unpins a display_order<=8 item', () => {
  assert.equal(isPinned({ deckKey: 'maps', displayOrder: 4 } as any, { maps: false }), false)
})
check('isPinned: explicit true override pins a display_order>8 item', () => {
  assert.equal(isPinned({ deckKey: 'nomad_flatnotes', displayOrder: 10 } as any, { nomad_flatnotes: true }), true)
})
check('isPinned: absent override falls back to the display_order rule', () => {
  // overrides present but no entry for this item's deckKey
  assert.equal(isPinned({ deckKey: 'maps', displayOrder: 4 } as any, { other: false }), true)
  assert.equal(isPinned({ deckKey: 'nomad_flatnotes', displayOrder: 10 } as any, { other: true }), false)
  // overrides object entirely absent
  assert.equal(isPinned({ deckKey: 'maps', displayOrder: 4 } as any), true)
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
check('groupIntoDecks: overrides unpin a pinned item and pin an unpinned one', () => {
  const items = [
    { deckKey: 'maps', displayOrder: 4 },            // knowledge-maps, pinned by rule
    { deckKey: 'nomad_flatnotes', displayOrder: 10 },// tools, NOT pinned by rule
    { deckKey: 'nomad_vaultwarden', displayOrder: 8 },// secure-ai, pinned by rule
  ]
  // Unpin Maps (knowledge-maps now empty -> hidden), pin Flatnotes (tools appears).
  const decks = groupIntoDecks(items as any, { maps: false, nomad_flatnotes: true })
  assert.deepEqual(decks.map(d => d.deck.key), ['secure-ai', 'tools-workshop'])
  assert.equal(decks.find(d => d.deck.key === 'tools-workshop')!.items.length, 1)
})
check('groupIntoDecks: absent overrides === legacy behavior', () => {
  const items = [
    { deckKey: 'maps', displayOrder: 4 },
    { deckKey: 'nomad_flatnotes', displayOrder: 10 },
    { deckKey: 'nomad_vaultwarden', displayOrder: 8 },
  ]
  const legacy = groupIntoDecks(items as any)
  const withEmpty = groupIntoDecks(items as any, {})
  assert.deepEqual(withEmpty.map(d => d.deck.key), legacy.map(d => d.deck.key))
})
console.log(`\n${p} checks passed`)
