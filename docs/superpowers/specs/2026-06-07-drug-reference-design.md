---
type: design-spec
status: draft-for-review
date: 2026-06-07
project: project-nomad (macOS / Apple-Silicon fork)
feature: Drug Reference v1 — offline FDA drug-label search
decided_by: Chris (2026-06-07) — scope LOCKED
container: nomad_admin (a feature, not its own container)
data_source: openFDA Drug Label bulk download (CC0 / public domain)
template: admin/ "Workshop / Offline STL Library" feature + the ZIM/map download-job flow
tags: [nomad, macos, drug-reference, openfda, offline, adonis, inertia, lucid, bullmq]
---

# Drug Reference v1

An offline, searchable reference of **FDA drug labels** (full Rx + OTC). While the
NOMAD is online, the admin downloads the openFDA drug-label dataset **from the
source**, ingests it locally into MySQL, and from then on the reference is fully
searchable **offline** — the same self-reliance posture as the existing ZIM /
map / STL features. It lives inside the existing `nomad_admin` container as a
feature; it is **not** a new container.

> **Scope is LOCKED** (Chris, 2026-06-07). This spec transcribes those decisions
> into an implementation-ready form. It does not widen scope. "Open questions"
> at the end are confirmation-at-review items, not invitations to expand.

## What this is NOT

- **Not a cross-drug pairwise interaction checker.** This v1 surfaces the
  `drug_interactions` *label section text for a single drug* — verbatim from its
  FDA label. It does **not** take two drugs and compute an interaction. That
  pairwise checker is a separate backlog item (**issue #9**) and is explicitly
  out of scope here.
- **Not medical advice.** The UI renders FDA label text as-is and carries the
  openFDA disclaimer (§7). It does not interpret, rank, or recommend.
- **Not MedlinePlus / AHFS / ASHP monographs.** Those drug monographs are
  copyrighted (AHFS® Consumer Medication Information is © ASHP) and are **not**
  redistributable, so they are excluded. We use only the CC0 openFDA label
  corpus.

---

## 1. Licensing — confirmed redistributable

openFDA data is released into the public domain under **Creative Commons CC0 1.0
Universal**. The openFDA license page states: *"the content, data,
documentation, code, and related materials on openFDA is public domain and made
available with a Creative Commons CC0 1.0 Universal dedication"* and that you may
*"copy, modify, distribute and perform the work, even for commercial purposes,
all without asking permission."*
[Source: https://open.fda.gov/license/]

- **Attribution:** not required.
- **One hard constraint (CC0 affirmer clause, carried into the UI):** *"When
  using or citing the work, you should not imply endorsement by the author or the
  affirmer"* — i.e. **must not imply FDA endorsement.** The UI therefore cites
  the source ("Source: U.S. FDA via openFDA — public domain (CC0)") **without**
  any wording that suggests the FDA endorses NOMAD.
  [Source: https://open.fda.gov/license/]
- **Disclaimer to surface verbatim** (from the dataset's own `meta.disclaimer`,
  see §2.2): *"Do not rely on openFDA to make decisions regarding medical care.
  While we make every effort to ensure that data is accurate, you should assume
  all results are unvalidated."* [Source: api.fda.gov/download.json `meta`, fetched 2026-06-07]
- **Carve-out we never touch:** the GMDN content inside *device* data has a
  separate license; we ingest only **drug/label**, which has no such carve-out.
  [Source: https://open.fda.gov/license/]

> Conclusion: the openFDA **drug/label** corpus is freely redistributable on the
> appliance. The only obligation is the no-endorsement wording, satisfied by the
> citation copy in §6.4.

---

## 2. The openFDA Drug Label bulk download (researched, with citations)

### 2.1 The download manifest

openFDA publishes a single machine-readable manifest of every downloadable
dataset at **`https://api.fda.gov/download.json`**. The drug-label dataset lives
at `results.drug.label` inside it. [Source: https://open.fda.gov/apis/drug/label/download/ ·
https://open.fda.gov/data/downloads/]

Verified shape (fetched 2026-06-07; `export_date: 2026-06-06`):

```jsonc
// GET https://api.fda.gov/download.json
{
  "meta": {
    "disclaimer": "Do not rely on openFDA to make decisions ...",
    "license": "https://open.fda.gov/license/",
    "last_updated": "2026-06-..."
  },
  "results": {
    "drug": {
      "label": {
        "export_date": "2026-06-06",
        "total_records": 258914,
        "partitions": [
          {
            "display_name": "/drug/label (part 1 of 13)",
            "file": "https://download.open.fda.gov/drug/label/drug-label-0001-of-0013.json.zip",
            "size_mb": "128.11",
            "records": 20000
          }
          // ... 13 partition objects total
        ]
      }
    }
  }
}
```

Each partition object has exactly four keys: `display_name`, `file` (the `.zip`
URL), `size_mb` (a **string**), `records`. [Source: api.fda.gov/download.json,
fetched 2026-06-07]

### 2.2 Partition table (the 2026-06-06 export — verified)

| Part | File | size_mb | records |
|---|---|---:|---:|
| 1 | `drug-label-0001-of-0013.json.zip` | 128.11 | 20000 |
| 2 | `drug-label-0002-of-0013.json.zip` | 143.09 | 20000 |
| 3 | `drug-label-0003-of-0013.json.zip` | 138.26 | 20000 |
| 4 | `drug-label-0004-of-0013.json.zip` | 137.54 | 20000 |
| 5 | `drug-label-0005-of-0013.json.zip` | 124.79 | 20000 |
| 6 | `drug-label-0006-of-0013.json.zip` | 131.13 | 20000 |
| 7 | `drug-label-0007-of-0013.json.zip` | 146.92 | 20000 |
| 8 | `drug-label-0008-of-0013.json.zip` | 134.11 | 20000 |
| 9 | `drug-label-0009-of-0013.json.zip` | 128.24 | 20000 |
| 10 | `drug-label-0010-of-0013.json.zip` | 134.87 | 20000 |
| 11 | `drug-label-0011-of-0013.json.zip` | 139.24 | 20000 |
| 12 | `drug-label-0012-of-0013.json.zip` | 133.73 | 20000 |
| 13 | `drug-label-0013-of-0013.json.zip` | 126.49 | 18914 |

- **Parts:** 13 (URLs base: `https://download.open.fda.gov/drug/label/`).
- **Total records:** **258,914**.
- **Total compressed:** **~1,746.52 MB ≈ 1.71 GB** (sum of `size_mb`).
- **Per part:** ~125–147 MB compressed, 20,000 records each (last part 18,914).
[Source: api.fda.gov/download.json `results.drug.label`, fetched 2026-06-07]

> These numbers grow with each weekly export. **Implementation MUST read the live
> manifest and iterate `partitions[]` dynamically** — never hardcode 13 parts or
> the URLs above. The table is a point-in-time snapshot for sizing only.
[Source: https://open.fda.gov/data/downloads/ — "data are broken up into many
small parts ... some endpoints have dozens of files."]

### 2.3 Internal structure of each `.zip` part

Each part is a single **zipped JSON file**. Unzipped, the JSON is a top-level
object — **not** a bare array — with the same `{ meta, results }` envelope as the
live API, where `results` is the **array of label records**. Verified against a
live record (`GET https://api.fda.gov/drug/label.json?limit=1`, fetched
2026-06-07): top-level keys `["meta","results"]`, `results` is an array.
[Source: https://open.fda.gov/data/downloads/ — "Each file is a zipped JSON
file." + live record fetch 2026-06-07]

> The streaming parser (§4) must therefore stream the array **at the `results`
> path**, not parse a root array. Uncompressed JSON per part is multiple GB —
> hence the streaming requirement.

### 2.4 The fields we extract per record (verified types)

Field types confirmed against the openFDA YAML field reference
(`https://open.fda.gov/fields/druglabel.yaml`, fetched 2026-06-07) **and** a live
record. Two type families matter:

**(a) Identity / version — scalar strings (NOT arrays):**

| Field | Type | Notes |
|---|---|---|
| `set_id` | string | *"globally unique identifier (GUID) for the labeling, stable across all versions or revisions."* Our **idempotency key**. |
| `id` | string | GUID for *this revision* of the document. |
| `version` | string | Sequential version number, starting at `1`. |
| `effective_time` | string | Label version date, format `YYYYMMDD` (openFDA `date` format). Maps to `source_updated_at`. |
[Source: druglabel.yaml + live record, fetched 2026-06-07]

**(b) `openfda` sub-object — every value is an ARRAY of strings:**

| Field | Type | Example (live) |
|---|---|---|
| `openfda.brand_name` | array[string] | `["SILICEA"]` |
| `openfda.generic_name` | array[string] | `["SILICEA"]` |
| `openfda.manufacturer_name` | array[string] | `["Rxhomeo Private Limited ..."]` |
| `openfda.product_ndc` | array[string] | `["15631-0404"]` |
| `openfda.route` | array[string] | `["ORAL"]` |
| `openfda.product_type` | array[string] | `["HUMAN OTC DRUG"]` / `["HUMAN PRESCRIPTION DRUG"]` — **OTC vs Rx discriminator** |
| `openfda.spl_set_id` | array[string] | `["0000025c-..."]` (mirrors `set_id`) |
[Source: druglabel.yaml + live record, fetched 2026-06-07]

**(c) Label section text — each is an ARRAY of strings, and FREQUENTLY ABSENT:**

| Field | YAML type | openFDA "area" (who has it) |
|---|---|---|
| `indications_and_usage` | array | prescription / OTC |
| `dosage_and_administration` | array | prescription / OTC |
| `warnings` | array | prescription / OTC |
| `boxed_warning` | array | some prescription / few OTC |
| `drug_interactions` | array | prescription / few OTC |
| `contraindications` | array | prescription / few OTC |
| `when_using` | array | few prescription / many OTC |
| `stop_use` | array | few prescription / many OTC |
[Source: https://open.fda.gov/fields/druglabel.yaml, fetched 2026-06-07 — every
listed section carries `type: array`; the "area" string is verbatim from the YAML.]

> Critical robustness fact, verified on a live OTC record: `boxed_warning`,
> `drug_interactions`, and `contraindications` were **entirely missing** from the
> record (not empty arrays — absent keys). The mapper (§5) MUST treat every
> section as optional and never assume presence. OTC labels skew toward
> `when_using` / `stop_use`; Rx labels toward `drug_interactions` /
> `contraindications` / `boxed_warning`. [Source: live record fetch 2026-06-07]

---

## 3. Data model — `drug_labels` table

`DrugLabel` Lucid model, table `drug_labels`. Mirrors the `stl_files` /
`inventory_items` conventions: `SnakeCaseNamingStrategy`; `@column` declares;
nullable columns as `T | null`; enum-ish values are plain varchars validated at
the edge, not native DB enums; defensive `consume` where the driver returns a
non-JS type. The migration stores the flattened section text as `text` /
`mediumtext` columns (openFDA sections can be long — `mediumtext` for the big
ones).

### 3.1 Columns

| Column | Type (migration) | Nullable | Notes |
|---|---|---|---|
| `id` | `bigIncrements` (primary) | no | Surrogate PK. |
| `set_id` | `string(64)` **UNIQUE** | no | openFDA `set_id` GUID. **Idempotent upsert key** — re-ingest updates in place. |
| `spl_id` | `string(64)` | yes | openFDA `id` (per-revision GUID), for provenance. |
| `version` | `string(16)` | yes | openFDA `version`. |
| `brand_name` | `string(255)` | yes | `openfda.brand_name[0]` (first element; see §5). |
| `generic_name` | `string(512)` | yes | `openfda.generic_name` joined (a label can list several). |
| `manufacturer` | `string(512)` | yes | `openfda.manufacturer_name[0]`. |
| `product_ndc` | `string(255)` | yes | `openfda.product_ndc` joined (often multiple NDCs). |
| `route` | `string(255)` | yes | `openfda.route` joined. |
| `product_type` | `string(32)` | yes | `openfda.product_type[0]` — `HUMAN OTC DRUG` / `HUMAN PRESCRIPTION DRUG`. Drives the OTC/Rx badge + filter. |
| `searchable_name` | `string(768)` | yes | Normalized brand+generic blob for search (see §3.3, §5.2). Indexed. |
| `indications` | `mediumtext` | yes | Flattened `indications_and_usage`. |
| `dosage` | `mediumtext` | yes | Flattened `dosage_and_administration`. |
| `warnings` | `mediumtext` | yes | Flattened `warnings`. |
| `boxed_warning` | `mediumtext` | yes | Flattened `boxed_warning`. |
| `drug_interactions` | `mediumtext` | yes | Flattened `drug_interactions` (single-drug label text — NOT a pairwise engine). |
| `contraindications` | `mediumtext` | yes | Flattened `contraindications`. |
| `when_using` | `text` | yes | Flattened `when_using` (OTC). |
| `stop_use` | `text` | yes | Flattened `stop_use` (OTC). |
| `source_updated_at` | `date` | yes | Parsed from `effective_time` (`YYYYMMDD`). |
| `ingested_at` | `timestamp` | no | `autoCreate` + `autoUpdate` — set on every upsert pass. |

> Sizing note: `string(768)` for `searchable_name` is chosen to stay within
> InnoDB's index key-length budget under `utf8mb4` (see §3.2). The big section
> bodies are `mediumtext` (up to 16 MB) so no openFDA section is ever truncated.

### 3.2 Indexes

The project runs **MySQL 8.0** (`image: mysql:8.0` in
`install/macos/compose.yaml` and `install/management_compose*.yaml`), default
engine **InnoDB**, charset `utf8mb4`. MySQL 8.0 InnoDB **supports `FULLTEXT`
natively** — confirmed by the deployed image. [Source: repo
`install/macos/compose.yaml` line 182, `install/management_compose.yaml` line 57.]

| Index | Columns / type | Serves |
|---|---|---|
| `uniq_drug_labels_set_id` | UNIQUE (`set_id`) | Idempotent upsert; provenance lookup. |
| `idx_drug_labels_product_type` | (`product_type`) | OTC vs Rx filter. |
| `idx_drug_labels_brand` | (`brand_name`) | Prefix/`LIKE` fallback + alpha sort. |
| `idx_drug_labels_searchable_name` | (`searchable_name`) | `LIKE 'term%'` fallback path. |
| `ft_drug_labels_name` | **FULLTEXT (`searchable_name`)** | Primary name search (relevance-ranked). |
| `ft_drug_labels_name_indications` | **FULLTEXT (`searchable_name`, `indications`)** | "search by what it treats" (name + indication). |

- **FULLTEXT min token length:** MySQL InnoDB FULLTEXT defaults to
  `innodb_ft_min_token_size = 3`; 1–2-char drug abbreviations (e.g. "D5") and
  short brand fragments may miss. The search service (§6.1) therefore uses a
  **hybrid strategy**: FULLTEXT `MATCH ... AGAINST` for the ranked path, with a
  `LIKE` fallback for short/partial terms. This is a service decision, not a DB
  tuning change (we do not require operators to edit `my.cnf`).
- **Fallback if FULLTEXT is unavailable** (e.g. a future non-InnoDB or older
  engine): the search service degrades to `LIKE '%term%'` on `searchable_name`
  + `brand_name`. The FULLTEXT indexes are additive; their absence must not break
  search. The migration creates them inside a `try`/guarded block and the service
  feature-detects (catch on `MATCH` → fall back to `LIKE`).

### 3.3 `searchable_name` normalization

Stored at ingest time so search never normalizes on the hot path. Built by the
pure `normalizeDrugName()` helper (§5.2) from `brand_name` + `generic_name`:
lowercase, strip punctuation to spaces, collapse whitespace, dedupe tokens. E.g.
brand `"Tylenol Extra Strength"` + generic `"acetaminophen"` →
`"tylenol extra strength acetaminophen"`.

### 3.4 Storage estimate

- **Raw zips (transient):** ~1.71 GB (the 13 parts), under
  `${NOMAD_DATA_ROOT}/storage/drug-data/`. **Open question (§9): delete after
  ingest?** Default proposal: delete each part's zip after it ingests
  successfully, keeping peak disk to one part (~150 MB) + the DB.
- **MySQL table:** ~259k rows. Label section text dominates; conservative
  estimate **~3–6 GB** in InnoDB for the corpus (label bodies are verbose; the
  uncompressed JSON is multiple GB per part). FULLTEXT indexes add roughly
  30–60% on top of the indexed text columns. **Budget: plan for ~8–10 GB** of
  drive headroom for the ingested table + indexes, plus ~1.71 GB transient for
  the zips during a download. (Refine on the mini after a real ingest — see §8.)

---

## 4. Download-from-source ingest pipeline (the hard part)

A BullMQ job — `IngestDrugLabelsJob` — orchestrates fetch → download → stream-
unzip → stream-parse → batch-upsert → progress, mirroring the ZIM/map
`RunDownloadJob` flow and the `EmbedFileJob` batch/continuation pattern. It uses
the **singleton `QueueService.getInstance()`** for every queue handle (the
existing files do this; constructing a fresh `QueueService` per call leaks Redis
connections — see the comment in `admin/app/services/queue_service.ts`).

### 4.1 Job identity, queue, retry (mirrors `RunDownloadJob`)

```
queue:   'drug-ingest'         // new queue; registered in commands/queue/work.ts
key:     'ingest-drug-labels'
jobId:   'drug-labels-ingest'  // single deterministic id → only one ingest at a time, re-runnable
add opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 5 }, removeOnFail: { count: 5 } }
```

- Register the new queue + handler in `admin/commands/queue/work.ts`
  (`handlers.set(IngestDrugLabelsJob.key, new IngestDrugLabelsJob())` +
  `queues.set(...)`), and give it **concurrency 1** in
  `getConcurrencyForQueue()` (one heavy stream at a time, like `EmbedFileJob`).
- Reuse the **`lockDuration: 600_000`** the worker already sets — a full ingest
  holds the worker for a long time; the existing 10-minute lock prevents the
  stalled-job kill that the worker comment documents.

### 4.2 The job's `handle()` — stage by stage

The job processes **one part per pass** and **self-dispatches a continuation**
for the next part (the `EmbedFileJob` continuation pattern), so a 13-part ingest
never holds a single job for the whole 1.7 GB and progress survives a worker
restart mid-corpus.

`job.data` shape:

```ts
interface IngestDrugLabelsJobParams {
  partIndex?: number          // which manifest partition to process this pass (default 0)
  manifest?: DrugLabelManifest // cached partitions[] from pass 0, passed to continuations
  totalParts?: number
  recordsIngested?: number     // running total across passes
  recordsSkipped?: number      // malformed/skipped running total
}
```

**(a) Pass 0 — fetch the manifest.**
- `GET https://api.fda.gov/download.json`, read `results.drug.label`.
  Persist `export_date`, `total_records`, and the `partitions[]` array (verified
  shape, §2.1) into `job.data.manifest` so continuations don't re-fetch.
- If offline (DNS/connection error), fail with a clear message (§7) — BullMQ
  retries with backoff; the UI shows "failed: no internet."

**(b) Download the current part** to
`${NOMAD_DATA_ROOT}/storage/drug-data/<basename>.zip` (in-container path
`/app/storage/drug-data/<basename>.zip` — the compose mounts
`${NOMAD_DATA_ROOT}/storage:/app/storage`, per `install/macos/compose.yaml`).
- **Reuse `doResumableDownload()`** from `admin/app/utils/downloads.ts` — it
  already gives `.tmp` staging, HTTP Range resume, stall detection (5-min), and a
  progress callback. Set `allowedMimeTypes` to skip (zip content-type varies) or
  to `['application/zip','application/octet-stream']`. Wire its `onProgress` into
  the part's download-progress slice (§4.3).

**(c) STREAM-unzip + STREAM-parse the part (MEMORY-SAFE — the core constraint).**
- **Never load the part into memory.** Uncompressed JSON per part is multiple GB.
- Pipeline (all streaming, back-pressured):
  `createReadStream(zipPath)` → **streaming unzip** → **streaming JSON parser
  scoped to the `results.*` array** → batched record handler.
- **Dependency to add** (none exists in `admin/package.json` today — confirmed):
  - Unzip: a streaming unzip that yields entry read-streams, e.g. **`yauzl`**
    (event/stream based, does not buffer the whole archive) or
    **`node-stream-zip`**. Each part contains a single JSON entry; open it as a
    read stream.
  - JSON: **`stream-json`** (`stream-json/streamers/StreamArray` +
    `stream-json/Pick` to pick the `results` path) — emits one record object at a
    time with constant memory. This is the established Node pattern for "iterate a
    huge JSON array without loading it."
- Concretely: `Pick({ filter: 'results' })` → `StreamArray()` → a `Writable`
  that accumulates a batch and flushes (§4d). Back-pressure: pause the parser
  while a batch upsert is in flight (`stream.pause()` / `resume()` around the
  awaited DB write), so memory stays bounded to one batch.

**(d) Map + batch-upsert into `drug_labels`.**
- For each parsed record, call the pure **`mapDrugLabelRecord()`** (§5.1) → a
  plain row object, or `null` if the record is unusable (no `set_id`).
- Accumulate rows into a batch and flush every **`BATCH_SIZE = 500`** records.
  (500 balances upsert round-trips vs. statement size with `mediumtext` bodies;
  tune on the mini.)
- Flush = **idempotent upsert on `set_id`**. Lucid:
  `DrugLabel.updateOrCreateMany('set_id', batch)` (matches on the UNIQUE
  `set_id`; inserts new, updates existing). Re-running the whole job thus
  **refreshes** the corpus in place — no duplicates, no manual purge.
- Count malformed records (mapper returned `null`, or a row threw on write):
  increment `recordsSkipped`, log at `warn`, **continue** — one bad record never
  aborts the part.

**(e) Report progress to the UI (like ZIM jobs).**
- `job.updateProgress(pct)` where `pct` blends parts-done and within-part record
  progress: `Math.floor(((partIndex + withinPartFraction) / totalParts) * 100)`.
- `job.updateData({ ...status fields })` carries the rich status the UI reads
  (§4.3): `phase`, `partIndex`, `totalParts`, `recordsIngested`,
  `recordsSkipped`, `currentPartName`. The download/embed jobs already use
  `updateData` for exactly this.

**(f) Continuation / completion.**
- After a part fully ingests: if `partIndex + 1 < totalParts`, **delete the
  part's zip** (default, per §3.4 open question) and **dispatch the next pass**
  with `partIndex + 1`, the cached `manifest`, and the running counts — the
  `EmbedFileJob` continuation idiom. The continuation MUST NOT reuse the
  deterministic `jobId` (BullMQ dedupe would swallow it against the
  active/lingering parent — exactly the bug `isContinuationBatch()` documents);
  let BullMQ auto-generate the continuation's id.
- On the final part: set `phase: 'completed'`, write the **last-updated**
  marker (KV key, §6.3) = manifest `export_date`, `updateProgress(100)`.

### 4.3 Status reported to the UI

Same surface as the existing download jobs (`DownloadService.listDownloadJobs`
maps BullMQ jobs to a DTO with `progress` / `status` / `failedReason`). A small
`DrugReferenceService.getIngestStatus()` reads the single
`drug-labels-ingest` job (+ its continuations) and returns:

```ts
interface DrugIngestStatus {
  state: 'idle' | 'running' | 'completed' | 'failed'
  progress: number            // 0..100
  phase: 'manifest' | 'downloading' | 'ingesting' | 'completed' | 'failed'
  partIndex: number
  totalParts: number
  currentPartName: string | null
  recordsIngested: number
  recordsSkipped: number
  failedReason?: string
  lastUpdated: string | null  // manifest export_date of the last successful ingest (KV)
  rowCount: number            // SELECT COUNT(*) FROM drug_labels (what's searchable now)
}
```

### 4.4 Edge cases handled by the pipeline

- **No internet:** manifest fetch or part download throws a connection error →
  job fails with `phase: 'failed'`, message "No internet — connect to download
  FDA drug data." BullMQ backoff retries; the UI shows the reason (failed jobs
  are surfaced, like the embed/download queues).
- **Partial / failed part:** `doResumableDownload` resumes the `.tmp` via Range;
  a part that fails mid-stream is retried by BullMQ `attempts`. Because upserts
  are idempotent on `set_id`, re-ingesting a partially-done part is safe (no
  dupes). Because each pass is one part with a continuation, a restart resumes at
  the failed part, not from part 1.
- **Malformed records:** mapper returns `null` (missing `set_id`) or a row throws
  → skip + `recordsSkipped++` + `warn` log; the part continues.
- **Drive unavailable:** the storage dir lives on the external drive. Before
  download, verify the storage path is writable (the project already has
  drive-aware helpers and a candidate-drive marker — `system_service.ts`); if not
  present, fail with "Storage drive not available."
- **Memory:** enforced by the streaming pipeline + 500-row batches +
  pause/resume back-pressure (§4c/d). No part is ever fully resident.

---

## 5. Pure, unit-testable helpers (the `embed_jobs.ts` pattern)

The Japa suite cannot boot locally (no DB/Redis). Per the project convention
(`admin/util/embed_jobs.ts` + `admin/tests/unit/embed_jobs.spec.ts`), the logic
that matters is extracted into **pure functions** in `admin/util/drug_labels.ts`,
unit-tested with `@japa/runner` `test.group` + `assert`. These take plain objects
(not BullMQ/Lucid types) so they run with zero infrastructure.

### 5.1 `mapDrugLabelRecord(record): DrugLabelRow | null`

```ts
// A structural shape of an openFDA label record — declared locally so the
// mapper stays pure (no Lucid/HTTP imports), like EmbedJobLike in embed_jobs.ts.
interface OpenFdaLabelRecord {
  set_id?: string
  id?: string
  version?: string
  effective_time?: string
  openfda?: {
    brand_name?: string[]
    generic_name?: string[]
    manufacturer_name?: string[]
    product_ndc?: string[]
    route?: string[]
    product_type?: string[]
  }
  indications_and_usage?: string[]
  dosage_and_administration?: string[]
  warnings?: string[]
  boxed_warning?: string[]
  drug_interactions?: string[]
  contraindications?: string[]
  when_using?: string[]
  stop_use?: string[]
}

interface DrugLabelRow {
  set_id: string
  spl_id: string | null
  version: string | null
  brand_name: string | null
  generic_name: string | null
  manufacturer: string | null
  product_ndc: string | null
  route: string | null
  product_type: string | null
  searchable_name: string | null
  indications: string | null
  dosage: string | null
  warnings: string | null
  boxed_warning: string | null
  drug_interactions: string | null
  contraindications: string | null
  when_using: string | null
  stop_use: string | null
  source_updated_at: string | null  // ISO date, parsed from effective_time
}

export function mapDrugLabelRecord(record: OpenFdaLabelRecord): DrugLabelRow | null
```

Behavior:
- **Returns `null`** if `set_id` is missing/empty (unusable — no idempotency
  key). This is the "skip + count" path the ingest pipeline relies on.
- **Flattens every string-array section** via a `flattenSection()` rule: `join`
  the array with `"\n\n"`, trim; absent/empty → `null`. Handles the verified fact
  that sections are often **absent keys**, not empty arrays.
- **`openfda` scalars:** `brand_name`/`manufacturer`/`product_type` take the
  **first** element; `generic_name`/`product_ndc`/`route` **join** with `", "`
  (labels legitimately list several). Missing → `null`.
- **`source_updated_at`:** parse `effective_time` `YYYYMMDD` → ISO `YYYY-MM-DD`;
  invalid/missing → `null`.
- **`searchable_name`:** `normalizeDrugName(brand_name, generic_name)` (§5.2).

**Test cases (`admin/tests/unit/drug_labels.spec.ts`):**
1. Full Rx record → all fields mapped; sections flattened with `\n\n`.
2. OTC record with `when_using`/`stop_use` present, `drug_interactions`/
   `contraindications`/`boxed_warning` **absent keys** → those map to `null`, no
   throw (the exact verified live shape).
3. Missing `set_id` → returns `null`.
4. Multi-element `generic_name`/`product_ndc`/`route` → joined with `", "`.
5. Multi-element `brand_name` → first element only.
6. `effective_time: "20240115"` → `source_updated_at: "2024-01-15"`;
   `effective_time: "garbage"` → `null`; missing → `null`.
7. Empty-array section (`indications_and_usage: []`) → `null` (not `""`).
8. `product_type: ["HUMAN OTC DRUG"]` → `"HUMAN OTC DRUG"`; missing → `null`.
9. Section array with embedded newlines/whitespace → trimmed, joined, no leading/
   trailing blank lines.

### 5.2 `normalizeDrugName(brand, generic): string | null`

```ts
export function normalizeDrugName(
  brand: string | null,
  generic: string | null
): string | null
```

Behavior: combine brand + generic; lowercase; replace non-alphanumeric with
spaces; collapse runs of whitespace; **dedupe tokens** preserving order; trim.
Both null/empty → `null`.

**Test cases:**
1. `("Tylenol", "acetaminophen")` → `"tylenol acetaminophen"`.
2. `("Tylenol Extra Strength", "acetaminophen")` →
   `"tylenol extra strength acetaminophen"`.
3. Duplicate tokens `("Silicea", "SILICEA")` → `"silicea"` (deduped).
4. Punctuation `("Co-Q10 (50 mg)", null)` → `"co q10 50 mg"`.
5. `(null, null)` → `null`; `("", "")` → `null`.
6. Extra whitespace `("  Advil   PM ", "ibuprofen")` →
   `"advil pm ibuprofen"`.

### 5.3 (Optional) `parseDrugLabelManifest(json): DrugLabelManifest`

A pure parser that extracts `{ export_date, total_records, partitions[] }` from
the `download.json` object, validating each partition has `file` + `records`.
Lets the manifest-handling logic be unit-tested without a network call. Test:
well-formed manifest → typed object; missing `results.drug.label` → throws a
clear error; partition missing `file` → skipped/flagged.

---

## 6. Search + UI

Mirrors the Workshop chain (types → model → migration → service → validator →
controller → routes → Inertia pages → home tile).

### 6.1 Search service — `DrugReferenceService`

- `search(query, { productType?, limit, offset })`:
  1. Normalize the query with `normalizeDrugName`.
  2. **FULLTEXT path:** `SELECT id, brand_name, generic_name, manufacturer,
     route, product_type FROM drug_labels WHERE MATCH(searchable_name) AGAINST
     (? IN NATURAL LANGUAGE MODE) [AND product_type = ?] ORDER BY relevance
     LIMIT ? OFFSET ?`.
  3. **Fallback path** (query < 3 chars, or FULLTEXT errors/returns nothing):
     `... WHERE searchable_name LIKE ? OR brand_name LIKE ? ...`.
  4. Always return a **slim DTO** list (id + name fields + product_type badge),
     never the full section bodies — detail loads on demand.
- `find(id)`: returns the full `DrugLabelDetail` (all section fields) for the
  detail view.
- `getIngestStatus()`: §4.3.
- `triggerIngest()`: dispatches `IngestDrugLabelsJob` (idempotent on the fixed
  jobId; returns "already running" if in flight, like `RunDownloadJob.dispatch`).
- `rowCount()`: `SELECT COUNT(*)` for the status panel.

### 6.2 Pages (Inertia/React, `AppLayout` + `<Head>`)

- **`inertia/pages/drug-reference/index.tsx`** — the search page:
  - Search box (debounced), OTC/Rx filter pills (`product_type`), results list.
  - Empty state when `rowCount === 0`: "No FDA drug data yet — download it
    below," with the download button + status (§6.3). This is the offline-first
    posture: search works only after an ingest.
  - Pagination / infinite-scroll for large result sets (259k rows → some queries
    return many; see open question §9 on how to cap/show 30k+ results — default:
    `LIMIT 50` per page, relevance-ordered, "showing top N" with paging).
- **`inertia/pages/drug-reference/show.tsx`** — the detail view:
  - Header: brand / generic / manufacturer / route / NDC / OTC-or-Rx badge.
  - Sections rendered in fixed clinical order, each shown **only if present**:
    Boxed Warning (visually emphasized) → Indications & Usage → Dosage &
    Administration → Warnings → Drug Interactions (label text; with a one-line
    note "single-drug label text, not an interaction checker") → Contraindications
    → When Using → Stop Use.
  - Footer: source citation (§6.4) + the openFDA disclaimer (§1).

### 6.3 Download / update control + status

On the search page (and/or an admin settings sub-tab, matching where ZIM/map
downloads live):
- **"Download / update FDA drug data"** button → `POST` the trigger route.
- A status block polling `getIngestStatus()` (the project uses
  `@adonisjs/transmit` for live updates and/or simple polling for download jobs —
  reuse whichever the ZIM/map UI uses): shows phase, part X/13, records ingested,
  records skipped, a progress bar, and **"Last updated: <export_date>"** from the
  KV marker.
- KV marker: add a `drugReference.lastUpdatedExportDate` (`'string'`) key to
  `KV_STORE_SCHEMA` (`admin/types/kv_store.ts`), written on successful completion
  (§4.2f), read by the status panel — the same `KVStore.getValue/setValue`
  pattern Inventory uses for `measurementSystem`.

### 6.4 Source citation (license-compliant, no implied endorsement)

Fixed footer/byline on the search + detail pages:

> **Source:** U.S. Food & Drug Administration drug labeling, via **openFDA** —
> public domain (CC0 1.0). NOMAD is not affiliated with or endorsed by the FDA.
> Label data is provided as-is; do not rely on it for medical decisions.

This satisfies the CC0 no-endorsement clause (§1) and carries the openFDA
disclaimer.

### 6.5 Home tile

Add a `DRUG_REFERENCE_ITEM` to `admin/inertia/pages/home.tsx` following the
`WORKSHOP_ITEM` / `READINESS_ITEM` shape:

```ts
const DRUG_REFERENCE_ITEM = {
  label: 'Drug Reference',
  to: '/drug-reference',
  target: '',
  description: 'Offline, searchable FDA drug labels (Rx + OTC)',
  icon: <IconPill size={48} />,        // IconPill / IconPrescription / IconVaccine
                                       // all exist in @tabler/icons-react ^3.34
                                       // (home.tsx already imports from it); pick
                                       // one and add to the import block.
  installed: true,
  displayOrder: 6,                      // between Workshop (5) and Preparedness (7)
  poweredBy: null,
}
```

---

## 7. Routes (ungated, mirroring existing patterns)

Add to `admin/start/routes.ts`. Page GETs unguarded; an `/api/drug-reference`
group for search + trigger/status. **No `localNetworkOnly` gate** — these write
**no files to disk on a user action** (the only disk write is the background
ingest job, which the user triggers but which runs server-side, like ZIM/map
downloads whose trigger routes are also ungated). This matches the suite's
existing posture (Inventory/Workshop single-row mutations are ungated; only
direct file *uploads* are gated).

```ts
import DrugReferenceController from '#controllers/drug_reference_controller'

// Page GETs (unguarded)
router.get('/drug-reference', [DrugReferenceController, 'index'])
router.get('/drug-reference/:id', [DrugReferenceController, 'show'])

// JSON API (ungated, mirrors /api/maps download-trigger group)
router
  .group(() => {
    router.get('/search', [DrugReferenceController, 'search'])
    router.get('/status', [DrugReferenceController, 'status'])
    router.post('/download', [DrugReferenceController, 'download']) // triggers ingest
  })
  .prefix('/api/drug-reference')
```

Controller mirrors `WorkshopController` / `InventoryController`: `index`/`show`
render Inertia; `search`/`status` return JSON; `download` dispatches the job;
integer-id guard on `show`; never leak exceptions to the UI.

### Files to create

```
admin/types/drug_reference.ts                 (enums: PRODUCT_TYPES; slim + detail DTOs; manifest types)
admin/app/models/drug_label.ts
admin/database/migrations/<ts>_create_drug_labels_table.ts   (ts after 1778600000003)
admin/app/services/drug_reference_service.ts  (search + status + trigger)
admin/app/jobs/ingest_drug_labels_job.ts      (the BullMQ ingest pipeline)
admin/app/validators/drug_reference.ts        (search-query + download validators)
admin/app/controllers/drug_reference_controller.ts
admin/util/drug_labels.ts                     (PURE — mapDrugLabelRecord, normalizeDrugName, parseManifest)
admin/tests/unit/drug_labels.spec.ts          (unit tests for the above)
admin/inertia/pages/drug-reference/index.tsx
admin/inertia/pages/drug-reference/show.tsx
admin/inertia/components/drug-reference/DrugResultRow.tsx
admin/inertia/components/drug-reference/IngestStatus.tsx
(edit) admin/start/routes.ts                   — /drug-reference + /api/drug-reference/*
(edit) admin/commands/queue/work.ts            — register 'drug-ingest' queue + handler, concurrency 1
(edit) admin/types/kv_store.ts                  — drugReference.lastUpdatedExportDate ('string')
(edit) admin/inertia/pages/home.tsx            — DRUG_REFERENCE_ITEM tile
(edit) admin/package.json                       — add streaming unzip + stream-json deps
```

---

## 8. Error handling / edge cases

| Case | Detection | Behavior |
|---|---|---|
| No internet (manifest) | fetch throws `ENOTFOUND`/`ECONNREFUSED` | Job fails, `phase: 'failed'`, msg "No internet — connect to download FDA drug data." UI shows reason. |
| No internet (mid-part) | `doResumableDownload` stall/abort | BullMQ retries; `.tmp` Range-resume picks up where it stopped. |
| Storage drive unavailable | storage path not writable (pre-check) | Fail with "Storage drive not available." No partial write. |
| Disk fills mid-download | write stream error | Part fails → retried; default zip-delete-after-part keeps peak low. Open question §9. |
| Malformed record (no `set_id`) | `mapDrugLabelRecord` → `null` | Skip + `recordsSkipped++` + `warn`. Part continues. |
| Malformed record (bad shape) | upsert throws on the row | Skip that row + count; batch continues (per-row try, not per-batch abort). |
| Section absent (verified common) | optional-chaining in mapper | Maps to `null`; detail view omits the section. No throw. |
| Manifest shape changed upstream | `parseDrugLabelManifest` validation | Fail with "Unexpected FDA manifest format" rather than silently ingesting nothing. |
| Re-run / refresh | fixed `jobId` + UNIQUE `set_id` | Idempotent: existing rows updated, new rows inserted, none duplicated. |
| Two ingest triggers race | deterministic `jobId` dedupe | Second returns "already running" (the `RunDownloadJob.dispatch` idiom). |
| Worker restart mid-corpus | continuation carries `partIndex` | Resumes at the in-flight part, not from part 1. |
| FULLTEXT unsupported/errors | service catches `MATCH` failure | Degrades to `LIKE` search; never breaks. |
| Short query (< 3 chars) | length check | Uses `LIKE` path (FULLTEXT min token = 3). |
| Empty corpus (never ingested) | `rowCount === 0` | Search page shows the "download first" empty state. |

---

## 9. Testing strategy

- **Pure helpers (the gate that runs locally):** `admin/util/drug_labels.ts`
  fully unit-tested (`mapDrugLabelRecord`, `normalizeDrugName`,
  `parseDrugLabelManifest`) per §5 — `@japa/runner` `test.group` + `assert`, no
  DB/Redis. Plus `tsc --noEmit`. This is the same gate the rest of the suite
  uses (the Japa integration suite **cannot boot locally** — no MySQL/Redis).
- **The real ingest is verified ON THE MINI, not locally.** The streaming
  download → unzip → parse → upsert path needs MySQL 8.0 + Redis + the external
  drive + ~1.7 GB of network, none of which exist in the local dev sandbox. On
  the mini: trigger a download, watch progress to 100%, confirm
  `SELECT COUNT(*) FROM drug_labels` ≈ manifest `total_records` minus skips,
  spot-check a known Rx (e.g. a boxed-warning drug) and a known OTC (e.g.
  acetaminophen) render their sections, confirm peak memory stays flat during
  ingest (the memory-safety requirement), and confirm a second run refreshes
  without duplicating rows. **Re-measure the real table + index size** to firm up
  the §3.4 storage budget.
- **Search:** on the mini, verify FULLTEXT relevance ordering, the `LIKE`
  fallback for 1–2-char terms, and the OTC/Rx filter.

---

## 10. Storage / size budget (summary)

| Item | Size | Source |
|---|---|---|
| Compressed parts (transient) | ~1.71 GB (13 parts) | api.fda.gov/download.json, 2026-06-07 |
| Peak transient disk (delete-after-part default) | ~150 MB (one part) | §3.4 |
| Ingested `drug_labels` table + FULLTEXT indexes | ~3–6 GB est. (confirm on mini) | §3.4 |
| Recommended drive headroom for the feature | ~8–10 GB | §3.4 |
| Records | 258,914 (grows weekly) | api.fda.gov/download.json, 2026-06-07 |

---

## 11. Open questions (confirm at review)

1. **FULLTEXT vs LIKE.** Spec proposes hybrid (FULLTEXT primary, LIKE fallback,
   feature-detected). Confirm we want both rather than LIKE-only for v1
   simplicity. (FULLTEXT is the right call for 259k rows, but it adds index
   weight and a `MATCH` code path.)
2. **Keep the raw zips after ingest?** Default proposal: **delete each part's zip
   after it successfully ingests** (peak disk ~150 MB). Alternative: keep all
   ~1.71 GB under `storage/drug-data/` for faster re-ingest / offline re-build.
   Which?
3. **Refresh cadence.** Manual-only (user clicks "update")? Or a nightly/weekly
   `CheckUpdateJob`-style check that compares the manifest `export_date` to the
   stored KV marker and notifies "new FDA data available"? (openFDA exports
   roughly weekly.)
4. **How to show 30k+ results.** A broad term (e.g. "acetaminophen") matches
   thousands of labels. Default: relevance-ranked `LIMIT 50` + paging + "showing
   top N of M." Confirm — or do we want dedup-by-drug (see #6) to collapse the
   count first?
5. **OTC vs Rx handling.** Spec stores `product_type` and offers an OTC/Rx filter
   pill + badge. Confirm that's enough, vs. e.g. separate sections or default-
   hiding one class.
6. **Dedup of multiple labels per drug.** openFDA has many `set_id`s for the same
   active ingredient (every manufacturer / repackager / strength is its own
   label) — 259k labels ≠ 259k distinct drugs. Do we (a) show every label
   (current spec — one row per `set_id`), (b) collapse the results list by
   `generic_name` with a "N labels" expander, or (c) collapse by
   `brand_name + generic_name`? This is the single biggest UX decision.
7. **`drug_interactions` framing.** v1 shows the single-drug label's interaction
   text. Confirm the UI note ("not an interaction checker — see issue #9") is the
   right way to set expectations and avoid implying the pairwise feature exists.
8. **Streaming-lib choice.** Spec proposes `yauzl`/`node-stream-zip` (unzip) +
   `stream-json` (parse). Confirm adding these deps to `admin/package.json` is
   acceptable, vs. a single combined lib.
9. **Boxed warning emphasis.** Render boxed warnings with strong visual weight
   (FDA labels them the most serious). Confirm styling intent (e.g. bordered red
   callout) is wanted, given the no-medical-advice posture.
10. **Where the download control lives.** On the Drug Reference page itself, in a
    Settings sub-tab (next to ZIM/map downloads), or both? (Spec proposes on the
    page, with the empty-state prompt.)

---

## Appendix A — Patterns this spec mirrors (read these at implementation)

| Concern | Existing file to mirror |
|---|---|
| Singleton queue | `admin/app/services/queue_service.ts` (`getInstance()`) |
| BullMQ job shape (queue/key/jobId/attempts/backoff/dispatch/status) | `admin/app/jobs/run_download_job.ts` |
| Batch + self-dispatched continuation; idempotent vs. continuation jobId | `admin/app/jobs/embed_file_job.ts` + `admin/util/embed_jobs.ts` (`isContinuationBatch`) |
| Resumable streaming download (Range, stall, progress) | `admin/app/utils/downloads.ts` (`doResumableDownload`) |
| Worker registration + per-queue concurrency + lockDuration | `admin/commands/queue/work.ts` |
| Download-job → UI status DTO | `admin/app/services/download_service.ts` + `admin/app/controllers/downloads_controller.ts` |
| Table migration (varchar enums, named indexes, up/down) | `admin/database/migrations/1778459218121_create_stl_files_table.ts` |
| Model (SnakeCase, nullable cols, defensive consume, static predicate) | `admin/app/models/inventory_item.ts`, `admin/app/models/stl_file.ts` |
| Controller chain (index/show Inertia, JSON mutations, id guards) | `admin/app/controllers/workshop_controller.ts`, `admin/app/controllers/inventory_controller.ts` |
| Routes (page GETs ungated, `/api/<feature>` group) | `admin/start/routes.ts` |
| Home tile | `admin/inertia/pages/home.tsx` (`WORKSHOP_ITEM`, `READINESS_ITEM`) |
| KV settings key | `admin/types/kv_store.ts` + `admin/app/models/kv_store.ts` |
| Pure helper + unit test (the local gate) | `admin/util/embed_jobs.ts` + `admin/tests/unit/embed_jobs.spec.ts` |
| Container storage mount (`${NOMAD_DATA_ROOT}/storage` → `/app/storage`) | `install/macos/compose.yaml` |

## Appendix B — Cited sources

- openFDA license (CC0, no-endorsement clause): https://open.fda.gov/license/
- Drug label download page: https://open.fda.gov/apis/drug/label/download/
- Downloads overview ("zipped JSON ... many parts"): https://open.fda.gov/data/downloads/
- Live manifest (partitions, sizes, counts, `meta.disclaimer`): https://api.fda.gov/download.json (`results.drug.label`, `export_date 2026-06-06`, fetched 2026-06-07)
- Field reference (section/openfda field types): https://open.fda.gov/fields/druglabel.yaml (fetched 2026-06-07)
- Live record (verified JSON shape, absent-section behavior): https://api.fda.gov/drug/label.json?limit=1 (fetched 2026-06-07)
- Drug labeling overview / endpoint usage: https://open.fda.gov/apis/drug/label/how-to-use-the-endpoint/
