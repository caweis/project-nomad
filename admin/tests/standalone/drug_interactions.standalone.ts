/**
 * Standalone gate test for the drug-interaction parser.
 *
 * Japa cannot boot locally without MySQL/Redis, so this file exercises the pure
 * parser directly under `node --experimental-strip-types`. It mirrors the Japa
 * spec at tests/unit/drug_interactions.spec.ts. Run:
 *   node --experimental-strip-types tests/standalone/drug_interactions.standalone.ts
 */
import assert from 'node:assert/strict'
import { parseInteractions, isSectionHeader, type InteractionBlock } from '../../util/drug_interactions.ts'

const MAXALT =
  '7 DRUG INTERACTIONS 7.1 Propranolol The dose of MAXALT should be adjusted in ' +
  'propranolol-treated patients, as propranolol has been shown to increase the plasma ' +
  'AUC of rizatriptan by 70% [see Dosage and Administration (2.4) and Clinical Pharmacology (12.3)] . ' +
  '7.2 Ergot-Containing Drugs Ergot-containing drugs have been reported to cause prolonged ' +
  'vasospastic reactions. 7.3 Other 5-HT 1 Agonists Because their vasospastic effects may be ' +
  'additive, co-administration of MAXALT and other 5-HT 1 agonists within 24 hours of each other ' +
  'is contraindicated [see Contraindications (4)] . 7.5 Monoamine Oxidase Inhibitors MAXALT is ' +
  'contraindicated in patients taking MAO-A inhibitors and non-selective MAO inhibitors.'

const ADVAIR =
  '7 DRUG INTERACTIONS ADVAIR DISKUS has been used concomitantly with other drugs without ' +
  'adverse drug reactions [see Clinical Pharmacology ( 12.2 )] . No formal drug interaction trials ' +
  'have been performed with ADVAIR DISKUS . • Strong cytochrome P450 3A4 inhibitors (e.g., ritonavir, ' +
  'ketoconazole): Use not recommended. ( 7.1 ) • Monoamine oxidase inhibitors and tricyclic ' +
  'antidepressants: Use with extreme caution. ( 7.2 ) • Beta-blockers: Use with caution. ( 7.3 ) ' +
  '7.1 Inhibitors of Cytochrome P450 3A4 Fluticasone propionate and salmeterol are substrates of CYP3A4.'

function words(s: string): string[] {
  return s.replace(/•/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
}

function reconstruct(blocks: InteractionBlock[]): string {
  return blocks
    .map((b) => {
      const parts: string[] = []
      if (b.label) parts.push(b.label)
      if (b.text) parts.push(b.text)
      if (b.bullets) parts.push(b.bullets.join(' '))
      return parts.join(' ')
    })
    .join(' ')
}

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── content fidelity (safety) ─────────────────────────────────────────────────
check('preserves every word of numbered (MAXALT) text', () => {
  assert.deepEqual(words(reconstruct(parseInteractions(MAXALT))), words(MAXALT))
})
check('preserves every word of bulleted (ADVAIR) text', () => {
  assert.deepEqual(words(reconstruct(parseInteractions(ADVAIR))), words(ADVAIR))
})

// ── structure ─────────────────────────────────────────────────────────────────
check('splits numbered text into labeled subsections', () => {
  const labels = parseInteractions(MAXALT)
    .map((b) => b.label)
    .filter((l): l is string => l !== null)
  assert.deepEqual(labels, ['7.1', '7.2', '7.3', '7.5'])
})
check('does not split on parenthetical cross-references', () => {
  const labels = parseInteractions(MAXALT).map((b) => b.label)
  assert.ok(!labels.includes('2.4'))
  assert.ok(!labels.includes('12.3'))
})
check('renders bulleted text as a bullet block', () => {
  const blocks = parseInteractions(ADVAIR)
  const bulletBlock = blocks.find((b) => b.bullets !== null)
  assert.ok(bulletBlock, 'expected a bullet block')
  assert.ok(bulletBlock!.bullets!.length > 2)
  assert.ok(blocks.map((b) => b.label).includes('7.1'))
})
check('separates the section header from the body', () => {
  assert.ok(isSectionHeader(parseInteractions(MAXALT)[0].text))
})
check('empty or null input yields no blocks', () => {
  assert.deepEqual(parseInteractions(null), [])
  assert.deepEqual(parseInteractions(''), [])
  assert.deepEqual(parseInteractions('   '), [])
})

console.log(`\n${passed} checks passed`)
