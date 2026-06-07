---
type: design-spec
status: approved
date: 2026-06-07
project: project-nomad (macOS / Apple-Silicon fork)
feature: Workshop-broaden v1 — STL library → general maker library (#6)
decided_by: Chris (2026-06-07) — approach + PDF-rendering choice LOCKED
container: nomad_admin (a feature, not its own container)
approach: EXTEND IN PLACE (keep stl_files table / StlFile / StlScannerService / stl-library/ dir)
template: the existing Workshop / Offline STL Library chain
tags: [nomad, macos, workshop, maker-library, cad, pdf, thumbnails, adonis, inertia, lucid]
---

# Workshop-broaden v1 (#6)

Broaden the STL-only Workshop into a general **maker library**: accept CAD, PDF,
and image files alongside STL/3MF, switch to a 14-category set, and generate
per-type thumbnails (STL renders, PDF first-page, resized images, per-type icon
fallback for CAD). **Extend the existing `stl_files` table in place** — no rename,
no data move. Real CAD/PDF *render* enrichments are deferred to #7.

> Scope confirmed on GitHub issue #6 (Chris, 2026-06-07). Approach (extend in
> place) and PDF-rendering choice (pdf2pic + ghostscript) chosen 2026-06-07.

## What this is NOT
- **Not a rename.** The table stays `stl_files`, the model `StlFile`, the service
  `StlScannerService`, the on-disk root `stl-library/`. Internal names stay
  STL-flavored; the user-facing tile is already "Workshop." A rename is a possible
  later cleanup, explicitly out of scope here.
- **Not real CAD rendering.** CAD files (.step/.stp/.dxf/.dwg/.f3d/.scad) get a
  per-type **icon** in v1, not a rendered preview. Real CAD render previews are #7.
- **Not richer PDF.** v1 renders the PDF **first page** as a thumbnail only.
  Multi-page preview, text extraction/search, and per-type rich metadata are #7.

---

## 1. Data model — extend `stl_files`

### 1.1 New column
Add to `stl_files`:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `file_type` | `string(16)` NOT NULL DEFAULT `'stl'` | no | Discriminator: `stl` \| `cad` \| `pdf` \| `image`. Plain varchar (the existing "enums are varchars, evolve without ALTER" convention). Indexed. |

Existing STL-specific columns stay as-is (all already nullable): `material`,
`print_time_minutes`, `infill_pct`, `difficulty`. They are populated/shown only
when `file_type='stl'`.

### 1.2 Index
`idx_stl_files_file_type` on (`file_type`) — drives the file-type filter and the
thumbnail-routing scan.

### 1.3 Category set: 7 → 14
Replace `STL_CATEGORIES` (medical, tools, household, replacement-parts,
agriculture, firearm-accessories, other) with the 14-set:

```
tools-hardware, replacement-parts, household, medical, agriculture-homestead,
woodworking, electronics, automotive, outdoor-survival, toys-games, art-decor,
firearm-accessories, education-models, other
```

`CATEGORY_LABELS` gets human-readable labels for all 14 (e.g. `tools-hardware` →
"Tools & Hardware", `agriculture-homestead` → "Agriculture & Homestead",
`education-models` → "Education & Models").

### 1.4 Existing-row remap (data migration)
A pure remap map, used by the migration AND unit-tested:

```ts
export const CATEGORY_REMAP: Record<string, string> = {
  tools: 'tools-hardware',
  agriculture: 'agriculture-homestead',
}
// medical, replacement-parts, household, firearm-accessories, other → unchanged (1:1)
```

No data loss: every old category maps to exactly one new category.

---

## 2. File classification (pure helper)

New pure helper `admin/util/file_classification.ts` (no Lucid/HTTP imports — the
`embed_jobs.ts` / `drug_labels.ts` pattern, unit-testable without DB/Redis):

```ts
export type WorkshopFileType = 'stl' | 'cad' | 'pdf' | 'image'

const EXT_MAP: Record<string, WorkshopFileType> = {
  '.stl': 'stl', '.3mf': 'stl',
  '.step': 'cad', '.stp': 'cad', '.dxf': 'cad', '.dwg': 'cad', '.f3d': 'cad', '.scad': 'cad',
  '.pdf': 'pdf',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
}

/** Lowercase-ext → file type, or null if not an indexable workshop file. */
export function classifyFileType(ext: string): WorkshopFileType | null

/** All indexable extensions (the union of EXT_MAP keys). */
export const INDEXABLE_EXTS: ReadonlySet<string>
```

`classifyFileType` lowercases + normalizes the leading dot, returns the mapped
type or `null`.

Also in this helper (type-aware metadata-completeness, replacing the STL-only
`StlFile.isMetadataComplete`):

```ts
export function isMetadataComplete(row: {
  file_type: string; name?: string | null; material?: string | null;
  print_time_minutes?: number | null; difficulty?: string | null;
}): boolean
// stl  → name && material && print_time_minutes > 0 && difficulty   (existing rule)
// else → !!name (non-empty)                                          (cad/pdf/image)
```

`StlFile.isMetadataComplete` becomes a thin wrapper over this helper (keeps the
model API stable for existing callers).

---

## 3. Thumbnails — per-type, routed by `file_type`

`StlScannerService.renderThumbnail()` becomes a switch on the row's `file_type`.
All paths keep the existing **30-second timeout** and the sticky `thumbnail_failed`
flag (set on a failed *attempt*, prevents retry on every scan).

| `file_type` | Renderer | Command / call | Notes |
|---|---|---|---|
| `stl` | `stl-thumb` (existing) | `stl-thumb -s 256 <in> <out>` | Unchanged. |
| `pdf` | **pdf2pic** (already a dep) | render page 1 → 256px PNG | pdf2pic wraps GraphicsMagick (already in image), which delegates PDF to **Ghostscript** — see §6 Dockerfile. Direct `gm convert "<in>.pdf[0]" -resize 256x256 <out>.png` is the documented fallback if pdf2pic is awkward (identical result, matches the stl-thumb shell-out pattern). |
| `image` | **sharp** (already a dep) | `sharp(in).resize(256,256,{fit:'inside'}).png().toFile(out)` | No system binary (libvips already installed). |
| `cad` | **none in v1** | — | No render attempt; `thumbnail_path` stays null, `thumbnail_failed` stays false. UI shows a per-type CAD icon. Real render is #7. |

Output path convention unchanged: `{LIBRARY_ROOT}/.thumbnails/{fileId}.png`.
On any renderer error (stl/pdf/image): log warn, set `thumbnail_failed=true`,
continue the scan (defensive, exactly like the current stl-thumb handling).

`INDEXABLE_EXTS` in the scanner is replaced by the union from
`file_classification.ts`; each indexed file's `file_type` is set via
`classifyFileType` at upsert time.

---

## 4. Upload + validation

- **Controller `upload()`**: expand `request.files('files', { extnames: [...], size: '200mb' })`
  to the full extension set (stl, 3mf, step, stp, dxf, dwg, f3d, scad, pdf, png,
  jpg, jpeg, webp, gif). Keep the 200 MB per-file cap (CAD .step/.f3d can be
  large). After move, set `file_type` via `classifyFileType` during `scanPaths`.
  Reject unknown extensions (classify → null).
- **Gate unchanged**: `POST /api/workshop/upload` stays behind `localNetworkOnly`.
- **`download()` MIME map**: extend the hardcoded map (`.stl`→model/stl,
  `.3mf`→model/3mf) with: pdf→application/pdf, png→image/png, jpg/jpeg→image/jpeg,
  webp→image/webp, gif→image/gif, and the CAD types → application/octet-stream.
- **`UploadDropZone.tsx`**: `accept` + client-side extension validation updated to
  the full set; per-file size check stays 200 MB.

---

## 5. UI

- **`StlCard.tsx`**: add a small file-type badge (STL / CAD / PDF / IMG). When
  `thumbnail_path` is null or `thumbnail_failed`, render a per-type icon:
  `stl`→`IconBox`, `cad`→`IconCube`, `pdf`→`IconFileTypePdf`, `image`→`IconPhoto`
  (all in `@tabler/icons-react ^3.34`). For `image` rows the thumbnail IS the
  resized image.
- **Filters (`WorkshopFilters.tsx` + index)**: add a **file-type** filter
  dropdown next to category. Category dropdown now lists the 14.
- **`show.tsx`**: type-aware form — the STL-only fields (material, print time,
  infill, difficulty) render **only when `file_type='stl'`**. All types show
  name / category / tags / description / source_url / license. The "metadata
  pending" hint uses the type-aware rule (non-STL is complete once named).
- **Home tile (`home.tsx`)**: description "Offline catalog of 3D-printable STL
  files" → "Offline maker library: 3D prints, CAD, PDFs, and reference images."
  Tile route/order/icon unchanged (`/workshop`, displayOrder 5, `IconBox`).

---

## 6. Migration + Dockerfile

### 6.1 Migration
`admin/database/migrations/<ts>_add_file_type_and_recategorize_stl_files.ts`
(timestamp after the latest existing migration):
- `up()`: add `file_type` varchar(16) NOT NULL default `'stl'` + `idx_stl_files_file_type`;
  `UPDATE stl_files SET category='tools-hardware' WHERE category='tools'` and
  `... 'agriculture-homestead' WHERE category='agriculture'` (idempotent — only
  the two remapped values change). Existing rows are all STL/3MF, so the
  `file_type` default `'stl'` backfills them correctly.
- `down()`: drop the index + column. (Category remap is not reversed — forward-only
  data normalization; documented.)

### 6.2 Dockerfile (one system package)
Add `ghostscript` to the existing apt line (line 4) — it is the PDF delegate
GraphicsMagick needs for pdf2pic. Explicit install (not relying on apt
Recommends):

```
RUN apt-get update && apt-get install -y bash curl graphicsmagick ghostscript libvips-dev build-essential
```

The CI image build verifies it installs on both arm64 and amd64 (both in Debian
repos). No new **node** dependency — pdf2pic and sharp are already in
`package.json` + the lockfile, so `npm ci` is unaffected.

---

## 7. Files to create / modify

```
CREATE admin/util/file_classification.ts          (classifyFileType, INDEXABLE_EXTS, isMetadataComplete, CATEGORY_REMAP)
CREATE admin/tests/unit/file_classification.spec.ts
CREATE admin/database/migrations/<ts>_add_file_type_and_recategorize_stl_files.ts
EDIT   admin/types/stl_library.ts                  (14 categories + labels; add file_type to slim/detail interfaces; WORKSHOP_FILE_TYPES enum)
EDIT   admin/app/models/stl_file.ts                (add file_type column; isMetadataComplete → wrapper over the pure helper)
EDIT   admin/app/services/stl_scanner_service.ts   (INDEXABLE_EXTS from helper; set file_type on upsert; renderThumbnail switch: stl-thumb/pdf2pic/sharp/cad-skip)
EDIT   admin/app/controllers/workshop_controller.ts (upload extnames; download MIME map)
EDIT   admin/app/validators/stl_library.ts         (list filter adds file_type; category enum → 14)
EDIT   admin/inertia/pages/workshop/index.tsx      (file-type filter wiring + enum prop)
EDIT   admin/inertia/pages/workshop/show.tsx       (type-aware form: hide STL fields for non-stl)
EDIT   admin/inertia/components/workshop/StlCard.tsx        (type badge + per-type icon fallback)
EDIT   admin/inertia/components/workshop/UploadDropZone.tsx (accept new extensions)
EDIT   admin/inertia/components/workshop/WorkshopFilters.tsx (file-type filter control)
EDIT   admin/inertia/pages/home.tsx                (tile description)
EDIT   Dockerfile                                  (add ghostscript to apt line)
```

No `package.json` change (pdf2pic + sharp already present) → no lockfile change.

---

## 8. Error handling / edge cases

| Case | Behavior |
|---|---|
| Unknown extension uploaded | `classifyFileType` → null → rejected at upload (and skipped by scan). |
| pdf2pic / ghostscript missing or errors | warn + `thumbnail_failed=true`, scan continues; UI shows PDF icon. |
| sharp fails on a corrupt image | warn + `thumbnail_failed=true`; UI shows image icon. |
| CAD file | no render attempt; icon by type; never marked failed. |
| stl-thumb missing | existing behavior (mark failed) unchanged. |
| Existing STL rows after migration | `file_type='stl'`, categories remapped; thumbnails already present, untouched. |
| Non-STL row metadata | "complete" once it has a name (type-aware rule). |
| Large CAD upload (>200 MB) | rejected by the size cap (same as STL today). |

---

## 9. Testing

- **Pure helpers (the local gate):** `file_classification.ts` fully unit-tested —
  `classifyFileType` for every extension + unknown + case/dot normalization;
  `isMetadataComplete` per file_type (stl strict, others name-only); `CATEGORY_REMAP`
  covers all 7 old values. `@japa/runner` + `assert`, no DB/Redis; run standalone
  via `node --experimental-strip-types`.
- **tsc:** backend 0; inertia at its 10-error baseline (no new errors).
- **Lockfile:** unchanged (no new node deps) — note in the PR, no `npm ci` risk.
- **Live (mini, operator):** upload one of each type; confirm STL render, PDF
  first-page thumbnail (proves ghostscript landed), image resize, CAD icon;
  confirm existing rows kept their thumbnails and got remapped categories;
  confirm the file-type filter + 14-category filter work; confirm download serves
  correct MIME per type.

---

## 10. Deferred to #7
- Real CAD render previews (.step/.dxf/.f3d → rendered thumbnail).
- Richer PDF: multi-page preview, text extraction/search (`pdf-parse` already a dep).
- Per-type rich metadata (PDF page count, CAD bounding-box/dimensions).
- Optional later cleanup: rename the STL-centric internals to workshop/maker.

## Appendix — patterns to mirror
| Concern | Existing file |
|---|---|
| Pure helper + unit test (local gate) | `admin/util/embed_jobs.ts` + `admin/tests/unit/embed_jobs.spec.ts` |
| Scanner walk + thumbnail render + sticky-fail | `admin/app/services/stl_scanner_service.ts` |
| Migration (varchar enums, named indexes, up/down) | `admin/database/migrations/1778459218121_create_stl_files_table.ts` |
| Controller upload (multipart, extnames, sanitize, collision) | `admin/app/controllers/workshop_controller.ts` |
| Card + per-type icon fallback | `admin/inertia/components/workshop/StlCard.tsx` |
| Dockerfile system-dep install | `Dockerfile` (line 4 apt line; stl-thumb .deb block) |
