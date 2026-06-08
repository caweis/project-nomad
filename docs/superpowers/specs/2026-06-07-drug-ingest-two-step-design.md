---
type: design-spec
date: 2026-06-07
status: approved
feature: Drug Reference ingest — two-step (download then ingest) + stall hardening
kind: bug-fix (live stall on the mini, v0.2.77)
target_version: next patch (priority; likely 0.2.710, bumping the migration batch to 0.2.711)
decided_by: Chris (2026-06-07; "two step process — download first then ingest", hybrid UX)
related:
  - admin/app/jobs/ingest_drug_labels_job.ts (current combined job)
  - admin/app/services/drug_reference_service.ts (getIngestStatus)
  - admin/inertia/components/drug-reference/IngestStatus.tsx (UI)
tags: [drug-reference, bullmq, ingest, bug]
---

# Drug Reference Ingest — Two-Step (Download → Ingest) + Stall Hardening

## Problem (live bug, v0.2.77 on the mini)

The Drug Reference download fails with **"job stalled more than allowable
limit."** Today a single BullMQ job per part does *download* (~130 MB, minutes)
**then** *stream-ingest* (~20k rows, minutes), then self-dispatches the next of
13 parts. "Stalled" = the job's lock went un-renewed past the stall window more
than `maxStalledCount` (default **1**) times. A long job gluing a flaky network
download to a heavy DB ingest is structurally fragile: a worker restart (deploy,
OOM, the Kiwix-restart side-effect) or a lock-renewal miss during a heavy stretch
trips it, and at `maxStalledCount=1` one trip fails the job and its continuation
chain. (Exact micro-trigger needs the mini's worker logs; the fragility is the
design, not a mystery.)

Scope note: "ingest into knowledge base" here means the **Drug Reference search
store (`drug_labels`)** — what the drug search queries — NOT the RAG/Qdrant
embeddings KB. (Embedding drug data into RAG is out of scope / separate.)

## Fix: separate the two failure domains

Split download from ingest so each job is short and single-concern.

- **Phase A — Download** (network-only failure domain): download each part to
  disk, resumable, with progress. A finished download is never thrown away.
- **Phase B — Ingest** (parse/DB-only failure domain): read the on-disk parts →
  stream into `drug_labels`, batched, with progress. **Re-runnable from disk
  with no re-download.**

Per-part bounded jobs within each phase (continuation-chained, the existing
pattern) keep every job small. Crucially, the ingest path no longer contains any
network I/O.

## Hybrid UX (decided 2026-06-07)

- **Two visible phases**, each with its own status + progress + retry.
- **Auto-chained by default:** one click on "Download FDA data" runs the
  download phase; on completion it auto-dispatches the ingest phase.
- **Independently controllable:** once parts are on disk, an **"Ingest into
  search"** button (re-)runs ingest from the downloaded files without
  re-downloading — covers "download fine, ingest failed" and re-ingest after a
  fix. Downloaded parts persist until a full ingest succeeds.

## Job architecture

Two job classes (or one class with a `phase` discriminator), each with a
deterministic jobId per phase so each phase is singleton + restartable
(same dispatch-clears-finished/failed pattern already in `dispatch()`):

- `DownloadDrugDataJob` — params `{ partIndex, manifest, totalParts, startedAt }`.
  Pass 0 fetches the manifest. Each pass downloads one part to `STORAGE_BASE`
  (resumable, `doResumableDownload`), updates download progress, then continues
  to the next part (auto jobId for continuations — the existing rule). After the
  last part: write a `drugReference.downloadState` marker (export_date, parts,
  paths) and, if auto-chain, dispatch `IngestDrugDataJob` pass 0.
- `IngestDrugDataJob` — params `{ partIndex, totalParts, recordsIngested,
  recordsSkipped, startedAt }`. Each pass reads one on-disk part and runs the
  existing `streamIngestPart` logic (yauzl + stream-json + batched
  `updateOrCreateMany` on set_id), updates ingest progress, continues to the
  next. After the last part: `writeFinalStatus(export_date)` and delete the
  downloaded parts (or keep behind a "clear cache" control — see Disk).

Reuse the current `streamIngestPart` body verbatim for Phase B (it is already
memory-safe + back-pressured). The only change is it reads a file that is
guaranteed already on disk.

## Stall hardening (regardless of the split)

On both queues' worker/job options:
- Raise `lockDuration` (e.g. 1800s) so a heavy part can't outrun its lock.
- Raise `maxStalledCount` (e.g. 3) so a single transient hiccup retries rather
  than fails the chain.
- Keep per-part bounded jobs (small units renew locks comfortably).
- Confirm the worker's `stalledInterval`/concurrency are sane for these queues.

## Disk management

- Download writes all parts to `STORAGE_BASE` and does NOT delete per-part after
  ingest (today it does, at job line ~230). Keep parts until a full ingest
  succeeds so re-ingest works.
- After a successful full ingest: delete the parts (reclaim ~1.7 GB). Optionally
  expose a "clear downloaded files" control. A re-download is required only if
  the user wants fresh data.

## Status model + UI

`getIngestStatus` returns a two-phase shape:
`{ download: {state, partsDone, totalParts, bytes?}, ingest: {state, records,
expectedTotal, partsDone}, phase: 'idle'|'downloading'|'downloaded'|'ingesting'
|'ready'|'failed', startedAtMs, error? }`.

`IngestStatus.tsx` shows both phases (download bar, ingest bar), the existing
"X of ~259k" counter on the ingest phase, the "Download FDA data" primary button,
and a secondary "Ingest into search" button enabled once parts are on disk. The
"Download failed" / "stalled" copy stays, scoped to whichever phase failed.

## Controller / routes

- `POST /api/drug-reference/download` → dispatch `DownloadDrugDataJob` (clears a
  finished/failed prior job first, per the existing idempotent pattern).
- `POST /api/drug-reference/ingest` → dispatch `IngestDrugDataJob` from the
  on-disk parts (404/guard if nothing downloaded). This is the manual re-ingest.
- Existing GET status endpoint returns the two-phase shape.

## What I can verify vs operator

- I build + gate: backend `npm run typecheck`=0; inertia tsc=baseline; build
  green; **no migration** (status via job data + KV); pure helpers
  (manifest parse, phase/status mapping) unit-tested standalone.
- I CANNOT run the multi-GB openFDA download+ingest locally — end-to-end proof
  is **operator-side on the mini**: Download → both phases progress → search
  works; kill the worker mid-ingest → re-"Ingest into search" resumes from disk
  with no re-download; a download failure no longer fails ingest and vice-versa.

## Out of scope

- Embedding drug data into the RAG/Qdrant knowledge base.
- Changing the openFDA source or the record mapping.
- Migrations (none needed).

## Testing

- Pure helpers: manifest parse (exists), download-state ↔ status mapping, the
  phase state machine — unit-tested via `node --experimental-strip-types`.
- Job logic: the continuation/jobId rules and phase transition covered by a
  focused test where the part loop is stubbed.
- Gates per the gate protocol (backend tsc 0 / inertia baseline / no deps / no
  migration), then operator mini-verify (above).
