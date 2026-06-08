/**
 * Standalone gate test for the two-step ingest pure helpers.
 *
 * Japa cannot boot locally without MySQL/Redis, so this file exercises the pure
 * helpers (partZipPath, parseDownloadState, deriveIngestPhase) directly under
 * `node --experimental-strip-types`. It mirrors the Japa spec at
 * tests/unit/drug_ingest_status.spec.ts. Run:
 *   node --experimental-strip-types tests/standalone/drug_ingest_status.standalone.ts
 */
import assert from 'node:assert/strict'
import {
  partZipPath,
  parseDownloadState,
  deriveIngestPhase,
  resolveExpectedTotal,
} from '../../util/drug_labels.ts'
import type {
  DrugLabelPartition,
  DrugDownloadStatus,
  DrugIngestPhaseStatus,
} from '../../types/drug_reference.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── partZipPath ──────────────────────────────────────────────────────────────
const p1: DrugLabelPartition = {
  display_name: 'part 1',
  file: 'https://download.open.fda.gov/drug/label/drug-label-0001-of-0013.json.zip',
  size_mb: '128',
  records: 20000,
}
check('partZipPath joins base + basename', () => {
  assert.equal(
    partZipPath('/app/storage/drug-data', p1),
    '/app/storage/drug-data/drug-label-0001-of-0013.json.zip'
  )
})
check('partZipPath round-trips a recorded path', () => {
  const recorded = '/app/storage/drug-data/drug-label-0007-of-0013.json.zip'
  assert.equal(
    partZipPath('/app/storage/drug-data', {
      display_name: 'p7',
      file: recorded,
      size_mb: '0',
      records: 0,
    }),
    recorded
  )
})

// ── parseDownloadState ───────────────────────────────────────────────────────
check('parseDownloadState parses a valid marker', () => {
  const raw = JSON.stringify({
    export_date: '2026-06-06',
    totalParts: 2,
    totalRecords: 258914,
    parts: [
      { index: 0, name: 'part 1', path: '/app/storage/drug-data/p1.zip', bytes: 100 },
      { index: 1, name: 'part 2', path: '/app/storage/drug-data/p2.zip', bytes: 200 },
    ],
    completedAtMs: 1717718400000,
  })
  const m = parseDownloadState(raw)
  assert.ok(m)
  assert.equal(m!.totalParts, 2)
  assert.equal(m!.totalRecords, 258914)
  assert.equal(m!.parts[1].path, '/app/storage/drug-data/p2.zip')
})
check('parseDownloadState defaults totalRecords to 0 on older markers', () => {
  const m = parseDownloadState(
    JSON.stringify({
      export_date: 'x',
      totalParts: 1,
      parts: [{ index: 0, name: 'p', path: '/p.zip', bytes: 1 }],
    })
  )
  assert.ok(m)
  assert.equal(m!.totalRecords, 0)
})
check('parseDownloadState null for null input', () => assert.equal(parseDownloadState(null), null))
check('parseDownloadState null for malformed JSON', () =>
  assert.equal(parseDownloadState('{not json'), null))
check('parseDownloadState null for empty parts', () =>
  assert.equal(
    parseDownloadState(JSON.stringify({ export_date: 'x', totalParts: 0, parts: [] })),
    null
  ))
check('parseDownloadState null when a part lacks path', () =>
  assert.equal(
    parseDownloadState(
      JSON.stringify({ export_date: 'x', totalParts: 1, parts: [{ index: 0, name: 'p', bytes: 1 }] })
    ),
    null
  ))
check('parseDownloadState defaults index/name/bytes', () => {
  const m = parseDownloadState(
    JSON.stringify({ export_date: 'x', totalParts: 1, parts: [{ path: '/p.zip' }] })
  )
  assert.ok(m)
  assert.equal(m!.parts[0].index, 0)
  assert.equal(m!.parts[0].name, '')
  assert.equal(m!.parts[0].bytes, 0)
})

// ── deriveIngestPhase ────────────────────────────────────────────────────────
const dl = (state: DrugDownloadStatus['state']): DrugDownloadStatus => ({
  state,
  partsDone: 0,
  totalParts: 13,
  currentPartName: null,
})
const ing = (state: DrugIngestPhaseStatus['state']): DrugIngestPhaseStatus => ({
  state,
  records: 0,
  expectedTotal: 0,
  partsDone: 0,
  totalParts: 13,
  currentPartName: null,
})

check('deriveIngestPhase idle', () => assert.equal(deriveIngestPhase(dl('idle'), ing('idle'), 0), 'idle'))
check('deriveIngestPhase downloading', () =>
  assert.equal(deriveIngestPhase(dl('running'), ing('idle'), 0), 'downloading'))
check('deriveIngestPhase downloaded', () =>
  assert.equal(deriveIngestPhase(dl('completed'), ing('idle'), 0), 'downloaded'))
check('deriveIngestPhase ingesting', () =>
  assert.equal(deriveIngestPhase(dl('completed'), ing('running'), 0), 'ingesting'))
check('deriveIngestPhase ready (ingest completed)', () =>
  assert.equal(deriveIngestPhase(dl('completed'), ing('completed'), 250000), 'ready'))
check('deriveIngestPhase ready (idle with rows)', () =>
  assert.equal(deriveIngestPhase(dl('idle'), ing('idle'), 250000), 'ready'))
check('deriveIngestPhase failed (ingest)', () =>
  assert.equal(deriveIngestPhase(dl('completed'), ing('failed'), 0), 'failed'))
check('deriveIngestPhase failed (download)', () =>
  assert.equal(deriveIngestPhase(dl('failed'), ing('idle'), 0), 'failed'))
check('deriveIngestPhase running ingest beats download failure', () =>
  assert.equal(deriveIngestPhase(dl('failed'), ing('running'), 0), 'ingesting'))
check('deriveIngestPhase running download beats ingest failure', () =>
  assert.equal(deriveIngestPhase(dl('running'), ing('failed'), 0), 'downloading'))
check('deriveIngestPhase completed download + failed ingest -> failed', () =>
  assert.equal(deriveIngestPhase(dl('completed'), ing('failed'), 0), 'failed'))

// ── resolveExpectedTotal (the 0 ?? fallback bug) ─────────────────────────────
check('resolveExpectedTotal prefers a real manifest total', () =>
  assert.equal(resolveExpectedTotal(258914, 13, 5000), 258914))
check('resolveExpectedTotal treats manifest 0 as unknown → parts estimate', () =>
  assert.equal(resolveExpectedTotal(0, 13, 5000), 13 * 20000))
check('resolveExpectedTotal treats manifest undefined as unknown → parts estimate', () =>
  assert.equal(resolveExpectedTotal(undefined, 13, 5000), 13 * 20000))
check('resolveExpectedTotal falls back to row count when parts also 0', () =>
  assert.equal(resolveExpectedTotal(0, 0, 5000), 5000))
check('resolveExpectedTotal falls back to row count when parts undefined', () =>
  assert.equal(resolveExpectedTotal(undefined, undefined, 5000), 5000))
check('resolveExpectedTotal honors a custom per-part estimate', () =>
  assert.equal(resolveExpectedTotal(0, 4, 0, 25000), 4 * 25000))

console.log(`\nAll ${passed} standalone assertions passed.`)
