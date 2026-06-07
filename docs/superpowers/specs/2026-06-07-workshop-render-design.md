---
type: design-spec
status: draft-for-review
date: 2026-06-07
project: project-nomad (macOS / Apple-Silicon fork)
feature: Workshop real CAD/PDF previews v1 — "free wins + cheap CAD tier" (#7)
decided_by: Chris (2026-06-07) — v1 scope LOCKED
container: nomad_admin (a feature, not its own container)
approach: EXTEND IN PLACE — extend StlScannerService.renderThumbnail + generateThumbnails; branch on extension within file_type='cad'; add PDF multi-page detail panel
tags: [nomad, macos, workshop, cad, f3d, dxf, scad, pdf, thumbnails, adonis, inertia, lucid]
---

# Workshop real CAD/PDF previews v1 (#7)

Extend the maker library shipped in #6 with four targeted render additions:
**.f3d** (Fusion 360 zip-extract preview PNG, zero new deps), **PDF multi-page**
(detail-view page strip + text extraction, no new deps), **.dxf** (ezdxf +
matplotlib → PNG, ~55 MB new apt deps), and **.scad** (openscad + xvfb → PNG,
~12 MB new apt deps). Everything else keeps the per-type icon from #6.

> **v1 scope is LOCKED** (Chris, 2026-06-07). This spec is implementation-ready.
> Open questions at the end are confirmation-at-review items only.

## What this is NOT

- **Not a STEP/IGES/STP renderer.** Those require FreeCAD or CadQuery (+250–400 MB)
  plus a virtual GL context. The right architecture is a sidecar container. Deferred
  to v2 — see §10.
- **Not a DWG renderer.** No free, redistributable, good-quality DWG renderer
  exists: ODA is proprietary; LibreDWG fidelity is inadequate for useful previews.
  `.dwg` stays a per-type icon permanently. Documented in §10.
- **Not AI-assisted CAD analysis.** Dimension extraction, BOM parsing, and
  STEP-level geometry analysis are backlog items, not part of this spec.
- **Not a PDF viewer.** The detail view shows a first-N-page thumbnail strip and
  exposes extracted text for search indexing. It is not an embedded PDF viewer
  (that would require `pdf.js` or an iframe, and is a separate backlog item).

---

## 1. Core design principle — extension-within-file-type dispatch

#6 routes `renderThumbnail` by `file_type`. That is insufficient for #7 because
within `file_type='cad'`, different extensions need different renderers:

- `.f3d` → Node zip-extract (yauzl + sharp, zero new deps)
- `.dxf` → ezdxf shell-out
- `.scad` → openscad + xvfb shell-out
- `.step`, `.stp`, `.iges`, `.dwg` → icon (no render)

The fix: `renderThumbnail` must accept the raw file extension alongside `fileType`,
and branch on extension first when `fileType === 'cad'`. `generateThumbnails`
already has the `StlFile` row in scope — it passes `extname(row.path).toLowerCase()`
as the new fourth argument.

### 1.1 Dispatch structure (illustrative)

```ts
// generateThumbnails — add ext parameter to the renderThumbnail call:
const ext = extname(row.path).toLowerCase()
const result = await this.renderThumbnail(row.path, row.id, ft, ext)

// renderThumbnail signature change:
private async renderThumbnail(
  fileRelPath: string,
  fileId: number,
  fileType: WorkshopFileType,
  fileExt: string,       // <-- new, e.g. '.f3d', '.dxf', '.scad', '.pdf'
): Promise<{ ok: true; thumbnailRelPath: string } | { ok: false; error: string }>

// Inside the switch:
switch (fileType) {
  case 'stl': { /* unchanged */ }

  case 'pdf': {
    // Thumbnail (first page) is unchanged from #6 / already ships.
    // No change needed here for the card thumbnail.
    // Multi-page detail rendering is a separate method — see §4.
  }

  case 'image': { /* unchanged */ }

  case 'cad': {
    // Branch on extension — within 'cad', only these three get a render:
    switch (fileExt) {
      case '.f3d':  return await this.renderF3dThumbnail(inputAbs, thumbAbs)
      case '.dxf':  return await this.renderDxfThumbnail(inputAbs, thumbAbs)
      case '.scad': return await this.renderScadThumbnail(inputAbs, thumbAbs)
      default:
        // .step, .stp, .iges, .dwg — icon, never marked failed
        return { ok: false, error: `no-renderer:${fileExt}` }
    }
  }
}
```

The `no-renderer:ext` sentinel is distinct from a real error. `generateThumbnails`
must NOT set `thumbnail_failed=true` for this sentinel — the caller checks the
error string prefix and continues without marking the row failed. This preserves
the existing contract that `thumbnail_failed` means "attempted and broken", not
"no renderer available."

```ts
// In generateThumbnails, after the renderThumbnail call:
if (result.ok) {
  row.thumbnail_path = result.thumbnailRelPath
  await row.save()
  generated++
} else if (result.error.startsWith('no-renderer:')) {
  // No renderer for this extension — leave thumbnail_path null,
  // thumbnail_failed false. UI shows icon. Not a failure.
  continue
} else {
  row.thumbnail_failed = true
  await row.save()
  failed++
  logger.warn(`[StlScannerService] thumbnail failed (${ft}/${fileExt}) on ${row.path}: ${result.error.slice(0, 200)}`)
}
```

---

## 2. Format: .f3d (Fusion 360 embedded preview)

### 2.1 Approach

A `.f3d` file is a ZIP archive. Fusion 360 embeds a preview image (PNG) inside
the archive at a path that is not publicly documented but empirically always
contains at least one `*.png` entry in the root or a `RootComponent/` subtree.
Strategy: open the zip with `yauzl` (already in `package.json` at ^3.2.0), iterate
entries, find the first entry whose name ends with `.png`, pipe it through `sharp`
(already at ^0.34.5) resized to 256×256, write to the thumbnail path.

This adds **zero new Node.js or system dependencies**.

### 2.2 Implementation

Extract into a private method `renderF3dThumbnail(inputAbs, thumbAbs)`:

```ts
import yauzl from 'yauzl'

private async renderF3dThumbnail(
  inputAbs: string,
  thumbAbs: string,
): Promise<{ ok: true; thumbnailRelPath: string } | { ok: false; error: string }> {
  // Lazy-import sharp (consistent with the 'image' branch pattern).
  const sharp = (await import('sharp')).default

  return new Promise((resolve) => {
    yauzl.open(inputAbs, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        resolve({ ok: false, error: err?.message ?? 'yauzl open failed' })
        return
      }

      const findPng = () => {
        zipfile.readEntry()
      }

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.toLowerCase().endsWith('.png')) {
          // Not a PNG — keep searching.
          zipfile.readEntry()
          return
        }

        // Found the first PNG — open its read stream.
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zipfile.close()
            resolve({ ok: false, error: streamErr?.message ?? 'stream open failed' })
            return
          }

          const chunks: Buffer[] = []
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
          readStream.on('end', async () => {
            zipfile.close()
            try {
              const buf = Buffer.concat(chunks)
              await sharp(buf).resize(256, 256, { fit: 'inside' }).png().toFile(thumbAbs)
              resolve({ ok: true, thumbnailRelPath: join(StlScannerService.THUMBNAIL_DIR, basename(thumbAbs)) })
            } catch (sharpErr) {
              const msg = sharpErr instanceof Error ? sharpErr.message : String(sharpErr)
              resolve({ ok: false, error: msg })
            }
          })
          readStream.on('error', (rErr: Error) => {
            zipfile.close()
            resolve({ ok: false, error: rErr.message })
          })
        })
      })

      zipfile.on('end', () => {
        // Reached end of zip without finding a PNG.
        resolve({ ok: false, error: 'no PNG entry found in .f3d archive' })
      })

      zipfile.on('error', (zipErr: Error) => {
        resolve({ ok: false, error: zipErr.message })
      })

      findPng()
    })
  })
}
```

**Timeout note:** This runs synchronously from the Node event loop via stream
callbacks. It does not use `execFile`, so there is no 30-second `execFile` timeout.
Wrap the whole Promise with a `Promise.race` against a 30-second `setTimeout`
rejection at the call site in `renderThumbnail` to cap runaway zip iteration.

### 2.3 Failure modes

| Condition | Result |
|---|---|
| File is a valid F3D but Fusion did not embed a preview PNG | `thumbnail_failed=true`; user can upload a thumbnail manually. |
| File is corrupt / not a valid ZIP | `thumbnail_failed=true` (yauzl parse error). |
| Embedded PNG is corrupt and sharp rejects it | `thumbnail_failed=true`. |
| Very large embedded PNG (>10 MB) | Sharp handles it; rare in practice for preview PNGs. |

---

## 3. Format: PDF multi-page (detail view) + text extraction

### 3.1 Card thumbnail (first page)

Already ships in #6 via `gm convert "${inputAbs}[0]" -resize 256x256 ...`.
No changes needed to `renderThumbnail` for the card thumbnail path.

### 3.2 Multi-page preview on the detail view

#7 adds a **page-strip panel** on `show.tsx` for PDF files. The backend generates
individual page PNGs on demand (or on first-view) and serves them; the frontend
renders them as a scrollable horizontal strip.

#### 3.2.1 Storage convention

Per-page thumbnails go into a subdirectory of `.thumbnails/`:

```
.thumbnails/
  {fileId}.png             ← card thumbnail (first page, existing from #6)
  pdf-pages/
    {fileId}/
      page-1.png
      page-2.png
      page-3.png
      page-4.png
```

Cap at **first 4 pages** for v1. This is enough for most reference PDFs (datasheets,
schematics, manuals) to be useful without unbounded disk usage. The cap is a named
constant `PDF_PREVIEW_PAGE_CAP = 4` in the service, easy to raise later.

#### 3.2.2 Generation

New private method `generatePdfPagePreviews(fileId, fileAbsPath)`:

```ts
private static readonly PDF_PREVIEW_PAGE_CAP = 4

private async generatePdfPagePreviews(
  fileId: number,
  fileAbsPath: string,
): Promise<{ pageCount: number; generatedPages: number }> {
  const pageDir = join(
    StlScannerService.LIBRARY_ROOT,
    StlScannerService.THUMBNAIL_DIR,
    'pdf-pages',
    String(fileId)
  )
  await fs.mkdir(pageDir, { recursive: true })

  // Use gm convert in a loop — consistent with the card thumbnail renderer
  // (same binary, same fallback, no new Node deps).
  // gm convert "${file}[N]" selects page N (0-indexed).
  // We probe up to PDF_PREVIEW_PAGE_CAP pages; stop when gm returns non-zero
  // (page out of range) to handle short PDFs gracefully.
  let generatedPages = 0
  for (let i = 0; i < StlScannerService.PDF_PREVIEW_PAGE_CAP; i++) {
    const outPath = join(pageDir, `page-${i + 1}.png`)
    try {
      await execFileAsync(
        'gm',
        ['convert', `${fileAbsPath}[${i}]`, '-resize', '512x512', '-background', 'white', '-flatten', outPath],
        { timeout: 30000 }
      )
      generatedPages++
    } catch {
      // Page N doesn't exist — PDF has fewer pages than the cap. Stop.
      break
    }
  }

  return { pageCount: generatedPages, generatedPages }
}
```

Resolution is 512×512 for page previews (vs 256 for card thumbnails) to keep text
legible at the wider panel width on `show.tsx`.

#### 3.2.3 When to generate

- **Triggered from the detail controller (`workshop_controller.ts show()`)**: if
  `file_type==='pdf'` and the `pdf-pages/{fileId}/` directory does not exist or is
  empty, call `generatePdfPagePreviews` before rendering the page. This is a
  lazy-on-first-view approach — no schema change, no background job needed.
- **Also triggered by `generateThumbnails`**: after the card thumbnail succeeds for
  a PDF row, call `generatePdfPagePreviews` inline. This pre-warms on scan so the
  detail view loads instantly.

#### 3.2.4 Serving the page images

New controller route:

```
GET /api/workshop/files/:id/pdf-page/:page
```

Serves `{LIBRARY_ROOT}/.thumbnails/pdf-pages/{id}/page-{page}.png` with
`Content-Type: image/png`. Returns 404 if the file or page doesn't exist. Identical
caching headers as the existing thumbnail endpoint (`Cache-Control: private,
max-age=3600`).

#### 3.2.5 Frontend — detail view page strip

In `show.tsx`, below the main thumbnail panel, for `file_type==='pdf'` rows add a
`<PdfPageStrip>` component:

```tsx
// Fetches /api/workshop/files/{id}/pdf-page/1 through /4 lazily (img src).
// Shows a horizontal scroll strip of page thumbnails.
// A "Pages: N" count badge shows next to the PDF icon or thumbnail.
```

The strip renders `<img src="/api/workshop/files/{id}/pdf-page/{n}" />` for n=1..4
with `onError` hiding images that 404 (fewer-than-4-page PDFs handled client-side
without an explicit page count API). No new React state management needed — just
`<img>` tags.

### 3.3 Text extraction + search

`pdf-parse` is already in `package.json` at ^2.4.5.

New column on `stl_files`: `pdf_text_extract TEXT NULL`. Populated during the scan
for `file_type==='pdf'` rows that don't have it yet. The controller's search/filter
logic can use this for full-text matching against PDF content.

Migration adds the column (see §9 for the full migration list).

```ts
// In generateThumbnails, after pdf card thumbnail succeeds:
if (ft === 'pdf' && row.pdf_text_extract === null) {
  try {
    const pdfParse = (await import('pdf-parse')).default
    const buf = await fs.readFile(inputAbs)
    const parsed = await pdfParse(buf, { max: 5 })  // first 5 pages of text
    row.pdf_text_extract = parsed.text.slice(0, 20000)  // cap at 20 KB
    await row.save()
  } catch {
    // Non-fatal — text extraction failure doesn't affect the thumbnail or scan result.
    logger.warn(`[StlScannerService] pdf-parse failed on ${row.path} — text search disabled for this file`)
  }
}
```

The 20 KB cap prevents runaway storage on very large documents. `max: 5` limits
parsing to the first 5 pages (fast for datasheets; the meaningful text is almost
always in the first few pages).

**No new Node.js dependency** — `pdf-parse` is already in the lockfile.

---

## 4. Format: .dxf (ezdxf + matplotlib)

### 4.1 Approach

`ezdxf` is a pure-Python DXF reader with a built-in draw module that uses
`matplotlib` with the Agg backend (non-interactive, no X11 display server required).
This is a genuinely headless path — no `xvfb` needed for DXF.

Shell-out via `execFileAsync` mirrors the existing `stl-thumb` pattern exactly.

### 4.2 System dependencies

New apt packages (add to the existing apt line in the Dockerfile):

| Package | Approx size | Purpose |
|---|---|---|
| `python3-ezdxf` | ~30 MB | DXF reader + draw module |
| `python3-matplotlib` | ~25 MB | Agg rendering backend |

Total new image layer: ~55 MB. This is a base-layer change — triggers a full
multi-arch rebuild (~25 min, see §8).

### 4.3 Render script

A small Python script, checked into the repo at
`admin/scripts/dxf_thumb.py`, wraps ezdxf + matplotlib in a CLI:

```python
#!/usr/bin/env python3
"""
dxf_thumb.py <input.dxf> <output.png> [size]

Renders the first modelspace of a DXF file to a PNG thumbnail.
Uses ezdxf draw + matplotlib Agg — fully headless, no display required.
Exit 0 on success, non-zero on error (message to stderr).
"""
import sys, os
import ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def main():
    if len(sys.argv) < 3:
        print("usage: dxf_thumb.py <input.dxf> <output.png> [size]", file=sys.stderr)
        sys.exit(1)

    dxf_path = sys.argv[1]
    out_path  = sys.argv[2]
    size      = int(sys.argv[3]) if len(sys.argv) > 3 else 256

    try:
        doc = ezdxf.readfile(dxf_path)
    except Exception as e:
        print(f"ezdxf read error: {e}", file=sys.stderr)
        sys.exit(2)

    msp = doc.modelspace()
    fig = plt.figure(figsize=(size / 96, size / 96), dpi=96)
    ax  = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    Frontend(ctx, out).draw_layout(msp, finalize=True)

    fig.savefig(out_path, dpi=96, format='png', bbox_inches='tight',
                facecolor='white')
    plt.close(fig)

if __name__ == '__main__':
    main()
```

### 4.4 Shell-out from the service

```ts
private async renderDxfThumbnail(
  inputAbs: string,
  thumbAbs: string,
): Promise<{ ok: true; thumbnailRelPath: string } | { ok: false; error: string }> {
  try {
    await execFileAsync(
      'python3',
      ['/app/scripts/dxf_thumb.py', inputAbs, thumbAbs, '256'],
      { timeout: 30000 }
    )
    return { ok: true, thumbnailRelPath: join(StlScannerService.THUMBNAIL_DIR, basename(thumbAbs)) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
```

The script path `/app/scripts/dxf_thumb.py` is the in-container path after
`COPY admin/ ./` (build stage) puts it at `/app/scripts/dxf_thumb.py` in the
production image.

### 4.5 Failure modes

| Condition | Result |
|---|---|
| DXF file is corrupt / non-standard variant | ezdxf raises parse error; exit 2; `thumbnail_failed=true` |
| Empty modelspace (title block only) | matplotlib renders blank white; still produces a PNG; `thumbnail_path` set |
| Very dense DXF (millions of entities) | matplotlib may be slow; 30s timeout caps it; `thumbnail_failed=true` on timeout |
| python3-ezdxf not installed (dev environment) | execFileAsync throws ENOENT; `thumbnail_failed=true` |

---

## 5. Format: .scad (OpenSCAD + xvfb)

### 5.1 Approach

OpenSCAD ships a `--headless` flag but the standard Debian/Ubuntu binary still
requires a GLX display for rendering (it uses OpenGL). The standard workaround is
`xvfb-run openscad ...` — Xvfb provides a virtual framebuffer, no GPU or physical
display needed. This is well-established (the OpenSCAD CI itself uses it).

### 5.2 System dependencies

| Package | Approx size | Purpose |
|---|---|---|
| `openscad` | ~10 MB | SCAD renderer |
| `xvfb` | ~2 MB | Virtual framebuffer for GLX |

Total new image layer: ~12 MB. Also a base-layer change (see §8).

### 5.3 Shell-out from the service

```ts
private async renderScadThumbnail(
  inputAbs: string,
  thumbAbs: string,
): Promise<{ ok: true; thumbnailRelPath: string } | { ok: false; error: string }> {
  try {
    // xvfb-run starts a virtual display, runs openscad, then tears it down.
    // --auto-servernum prevents collisions if multiple renders run concurrently.
    // --server-args sets the screen resolution / color depth.
    await execFileAsync(
      'xvfb-run',
      [
        '--auto-servernum',
        '--server-args', '-screen 0 1024x768x24',
        'openscad',
        '--imgsize=256,256',
        '-o', thumbAbs,
        inputAbs,
      ],
      { timeout: 30000 }
    )
    return { ok: true, thumbnailRelPath: join(StlScannerService.THUMBNAIL_DIR, basename(thumbAbs)) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
```

### 5.4 Failure modes

| Condition | Result |
|---|---|
| SCAD file references missing external geometry | OpenSCAD exits with error; `thumbnail_failed=true` |
| SCAD file uses `import()` with a path that doesn't exist in the container | Same as above |
| Very complex geometry → render > 30 s | Timeout; `thumbnail_failed=true` |
| xvfb or openscad missing (dev environment) | execFileAsync throws ENOENT; `thumbnail_failed=true` |
| xvfb server number collision under concurrent scans | `--auto-servernum` prevents this |

---

## 6. generateThumbnails — updated routing overview

The full routing logic after #7, for reference:

| `file_type` | Extension | Renderer | Binary / lib | New? |
|---|---|---|---|---|
| `stl` | `.stl`, `.3mf` | stl-thumb | system binary (existing) | No |
| `pdf` | `.pdf` | gm convert | GraphicsMagick + Ghostscript (existing) | No (card); page-strip new |
| `image` | `.png`, `.jpg`, etc. | sharp | Node native (existing) | No |
| `cad` | `.f3d` | zip → PNG (yauzl + sharp) | Node (existing deps) | New |
| `cad` | `.dxf` | dxf_thumb.py (ezdxf + matplotlib) | python3-ezdxf, python3-matplotlib | New |
| `cad` | `.scad` | xvfb-run openscad | openscad, xvfb | New |
| `cad` | `.step`, `.stp`, `.iges`, `.dwg` | none | — | No (icon) |

---

## 7. UI changes

### 7.1 show.tsx — PDF page strip

For `file_type === 'pdf'`:
- Below the main thumbnail area (which shows the page-1 card thumbnail), add a
  `<PdfPageStrip fileId={props.file.id} />` component.
- `PdfPageStrip` renders `<img>` tags for pages 1–4 in a horizontal scrolling
  row. `onError` hides any image that 404s (pages beyond the document's actual
  count). No loading spinner needed — `<img>` lazy-loads natively.
- A "PDF" badge next to the filename already exists from #6 file-type indicator.
  No additional badge needed.

### 7.2 show.tsx — PDF text extract display

For `file_type === 'pdf'` and `file.pdf_text_extract` is non-null:
- Add a collapsed `<details>` disclosure below the page strip labelled
  "Extracted text (for search)". The content is the raw extracted text in a
  `<pre className="text-xs overflow-auto max-h-48">`. This gives the operator a
  way to verify the extraction without cluttering the main form.
- The controller must pass `pdf_text_extract` in the `StlFileDetail` prop (or a
  boolean flag `has_text_extract` to avoid sending 20 KB of text in the page
  payload — see open questions §11).

### 7.3 Card thumbnails (index.tsx / StlCard.tsx)

No changes needed. Once `renderThumbnail` sets `thumbnail_path` for .f3d / .dxf /
.scad rows, `StlCard.tsx` already displays the thumbnail via the existing
`/api/workshop/files/{id}/thumbnail` endpoint. The per-type icon fallback from #6
continues to show for `.step`, `.stp`, `.iges`, `.dwg`, and any row where
`thumbnail_failed=true`.

### 7.4 No new filter controls

#7 adds no new filter controls to `index.tsx`. The existing file-type filter from
#6 already distinguishes CAD from other types. Sub-extension filtering (e.g.
"show only .dxf") is a backlog item.

---

## 8. Dockerfile changes

### 8.1 Updated apt line

Replace the existing apt line (currently line 4) with:

```dockerfile
RUN apt-get update && apt-get install -y \
    bash curl graphicsmagick ghostscript libvips-dev build-essential \
    python3-ezdxf python3-matplotlib \
    openscad xvfb
```

All four new packages are in the standard Debian Bookworm (node:22-slim base)
`apt` repositories. No PPAs, no external downloads, no checksum verification
needed beyond apt's own signature verification.

### 8.2 Copy the dxf_thumb.py script

The build stage already does `ADD admin/ ./`, which will copy
`admin/scripts/dxf_thumb.py` into `/app/scripts/dxf_thumb.py` in the container.
No explicit `COPY` instruction needed if the file lives under `admin/`.

Ensure the script is executable (the service calls it via `python3 script_path`,
not as an executable, so the +x bit is not strictly required, but set it anyway
for consistency with stl-thumb):

```dockerfile
RUN chmod +x /app/scripts/dxf_thumb.py
```

### 8.3 Multi-arch rebuild impact

**This is a base-layer change.** Adding packages to the `FROM node:22-slim AS base`
layer invalidates all downstream layer caches. The next build is a full multi-arch
rebuild (~25 min for arm64 + amd64 on the CI builder). This is the same class of
change as adding `ghostscript` in #6. Document it in the PR description so the
team knows to expect the longer CI run.

After the one-time rebuild, subsequent builds that don't touch the Dockerfile cache
from the `FROM base AS deps` layer onward and remain fast (~3–5 min).

**No new Node.js dependencies.** `yauzl`, `sharp`, `pdf2pic`, and `pdf-parse` are
already in `admin/package.json` and the lockfile. `npm ci` is unaffected.

---

## 9. Data model change — new column

One new column on `stl_files`:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `pdf_text_extract` | `TEXT` | YES | Extracted text from the first 5 pages of a PDF (pdf-parse). NULL for non-PDF rows and for PDFs where extraction failed or hasn't run yet. Capped at 20 KB stored. |

Migration: `admin/database/migrations/<ts>_add_pdf_text_extract_to_stl_files.ts`

```ts
// up()
table.text('pdf_text_extract').nullable()

// down()
table.dropColumn('pdf_text_extract')
```

No index needed for v1 (MySQL full-text search via LIKE is sufficient for the
operator's personal library; a FULLTEXT index is a v2 enhancement if the library
grows large).

---

## 10. Files to create / modify

```
CREATE admin/scripts/dxf_thumb.py                                   (ezdxf + matplotlib CLI renderer)
CREATE admin/database/migrations/<ts>_add_pdf_text_extract_to_stl_files.ts

EDIT   admin/app/services/stl_scanner_service.ts
         • renderThumbnail: add fileExt param; cad branch dispatches to renderF3dThumbnail /
           renderDxfThumbnail / renderScadThumbnail / no-renderer sentinel
         • generateThumbnails: pass ext to renderThumbnail; handle no-renderer:
           sentinel without setting thumbnail_failed; call generatePdfPagePreviews
           and pdf-parse text extraction after pdf card thumbnail succeeds
         • ADD renderF3dThumbnail (yauzl + sharp zip extract)
         • ADD renderDxfThumbnail (python3 dxf_thumb.py shell-out)
         • ADD renderScadThumbnail (xvfb-run openscad shell-out)
         • ADD generatePdfPagePreviews (gm convert loop, PDF_PREVIEW_PAGE_CAP=4, 512px)

EDIT   admin/app/controllers/workshop_controller.ts
         • show(): trigger generatePdfPagePreviews lazily if pdf-pages/{id}/ missing
         • ADD route handler for GET /api/workshop/files/:id/pdf-page/:page

EDIT   admin/app/models/stl_file.ts
         • ADD pdf_text_extract: string | null column declaration

EDIT   admin/inertia/pages/workshop/show.tsx
         • ADD <PdfPageStrip> component for file_type==='pdf'
         • ADD pdf text extract disclosure for file_type==='pdf'

EDIT   Dockerfile
         • Add python3-ezdxf python3-matplotlib openscad xvfb to the apt line
         • ADD RUN chmod +x /app/scripts/dxf_thumb.py
```

No changes to `admin/util/file_classification.ts` (extension map is complete from
#6), `admin/types/stl_library.ts` (WorkshopFileType covers all cases), or any
validator/filter files (no new filter controls in v1).

---

## 11. Error handling + edge cases

| Case | Behavior |
|---|---|
| `.f3d` is a valid ZIP but contains no PNG entry | `thumbnail_failed=true`; user uploads PNG manually. |
| `.f3d` is corrupt (not a valid ZIP) | yauzl parse error → `thumbnail_failed=true`. |
| `.dxf` empty modelspace | matplotlib renders blank white PNG; `thumbnail_path` set (valid preview). |
| `.dxf` parse error (non-standard variant) | ezdxf exits non-zero; `thumbnail_failed=true`. |
| `.scad` references missing `import()` files | openscad exits non-zero; `thumbnail_failed=true`. |
| Any renderer exceeds 30 s | execFileAsync/Promise.race timeout; `thumbnail_failed=true`. |
| No-renderer extension (`.step`, `.stp`, `.iges`, `.dwg`) | `no-renderer:ext` sentinel; `thumbnail_path` remains null; `thumbnail_failed` remains false; icon shown. |
| PDF page-strip directory creation fails (disk full) | Log error; page strip silently unavailable in detail view (img 404s). |
| pdf-parse fails on a corrupt PDF | Log warn; `pdf_text_extract` stays null; card thumbnail and page strip unaffected. |
| python3-ezdxf / openscad / xvfb not installed (dev env) | execFileAsync ENOENT → `thumbnail_failed=true`; log warn once per scan (probe like `hasStlThumb()` if needed). |
| Concurrent xvfb renders (multiple SCAD files in scan) | `--auto-servernum` prevents display number collision. |
| .f3d embedded PNG larger than sharp's default memory | sharp handles large buffers; 256px output is always small. |

---

## 12. Testing

### 12.1 Pure unit tests (local gate — Node, no DB)

Extract the extension-to-renderer-strategy mapping into a pure helper:

```ts
// admin/util/cad_render_strategy.ts
export type CadRenderStrategy = 'f3d' | 'dxf' | 'scad' | 'icon'

export function cadRenderStrategy(ext: string): CadRenderStrategy {
  switch (ext) {
    case '.f3d':  return 'f3d'
    case '.dxf':  return 'dxf'
    case '.scad': return 'scad'
    default:      return 'icon'
  }
}
```

Unit test `admin/tests/unit/cad_render_strategy.spec.ts`:

```ts
// Covers every CAD extension:
// .f3d → 'f3d'
// .dxf → 'dxf'
// .scad → 'scad'
// .step, .stp, .iges, .dwg, .unknown → 'icon'
// Case normalization: '.DXF' → 'dxf' (pass lowercased, document the contract)
```

This is the pattern from `file_classification.ts` / its spec file — pure function,
no DB, no container, runs with `node --experimental-strip-types`.

### 12.2 Integration / live verification (on the mini)

Run `node ace stl:reindex` (or "Rescan library" in Workshop UI) with one test file
of each format. Verify:

- `.f3d` — card thumbnail appears (confirm via the Workshop index grid); the
  embedded preview PNG is visible (not a blank or broken image).
- `.dxf` — card thumbnail shows a DXF outline/drawing.
- `.scad` — card thumbnail shows the rendered geometry.
- `.pdf` (any) — detail view shows the page strip (pages 1–N up to 4); text
  extract disclosure shows non-empty text for a text PDF.
- `.step`, `.stp`, `.dwg` — still show the CAD icon; `thumbnail_failed` is false.
- Corrupt `.f3d` (rename a zip to .f3d with no PNG entries) — `thumbnail_failed`
  set; amber banner on detail view offering manual upload.

### 12.3 Build verification

- `tsc` (admin): 0 new errors (baseline is 10 pre-existing inertia errors, per #6
  spec).
- Lockfile: unchanged — confirm `npm ci` produces no lockfile diff.
- Dockerfile: run `docker build --platform linux/arm64 .` locally on the mini to
  confirm all four new apt packages resolve before pushing.

---

## 13. Deferred to v2 / v3

### 13.1 STEP / STP / IGES — sidecar container approach (v2)

Real rendering of parametric CAD formats (`.step`, `.stp`, `.iges`) requires either
**FreeCAD** (250–400 MB install) or **CadQuery/OCP** (100–150 MB Python wheel) plus
a virtual OpenGL context. Adding these to the main `nomad_admin` image would:

1. Inflate the image by 250–400 MB (3–5× the current image size).
2. Extend the multi-arch rebuild from ~25 min to 60–90 min.
3. Make the main container responsible for an unrelated Python runtime with its own
   security surface.

**v2 pattern: HTTP sidecar container.** A separate `nomad_cad_preview` container
runs FreeCAD or CadQuery, exposes a single HTTP endpoint
`POST /render { filePath, format, size }` → PNG bytes, and is defined in
`install/macos/compose.yaml` as an opt-in service. `StlScannerService` calls it
over the Docker internal network when available (feature-flagged; graceful
degradation to icon if the sidecar is not running). The main `nomad_admin` image
stays lean. This sidecar rebuilds on its own slower schedule and does not block
the main image CI.

### 13.2 DWG — permanently an icon

`.dwg` files will not receive a real renderer in any planned version. The reasons:

1. **ODA Teigha** (the only high-fidelity DWG renderer) is proprietary and not
   freely redistributable.
2. **LibreDWG** (GPLv3, fully free) has documented fidelity limitations: AutoCAD
   versions newer than R2013 may not render correctly, and complex hatching /
   external references are unreliable.
3. **ezdxf can read DXF not DWG** — a separate ezdxf export step would be needed,
   and that requires a DWG→DXF converter, which loops back to LibreDWG.

Decision: `.dwg` stays a per-type icon. Users wanting previews should convert to
`.dxf` before importing (most CAD tools support this export natively).

### 13.3 Other deferred items

- `.3mf` CAD-metadata thumbnails (3MF contains embedded thumbnails like F3D —
  similar zip-extract approach, but `.3mf` already has a working STL-path render,
  so this is low priority).
- PDF FULLTEXT index (MySQL `FULLTEXT` on `pdf_text_extract`) for fast keyword
  search across the library.
- Sub-extension filter control on the Workshop index page (e.g. show only `.dxf`
  files within the CAD type).
- PDF embedded viewer (`pdf.js` or `<iframe>`) on the detail view.
- SCAD parameterization panel (read `parameter` blocks from the SCAD file and
  expose them in the detail form).

---

## 14. Open questions — confirm at review

1. **F3D PNG entry path**: Empirical testing on the mini with real `.f3d` files
   should confirm that `yauzl` finds a `*.png` entry in typical Fusion 360
   archives. If the entry is nested under a specific path (e.g.
   `RootComponent/Thumbnail.png`) rather than enumerable by extension, the search
   strategy may need to target that path directly. **Action: test 3–5 real .f3d
   files on the mini before implementing.**

2. **PDF text extract in `show()` prop**: Should the controller pass the full
   `pdf_text_extract` string in the Inertia page props (up to 20 KB per page
   load), or a boolean `has_pdf_text`? For v1 the detail view only shows a
   disclosure widget, so the full text is only useful there — a separate lazy
   fetch (`GET /api/workshop/files/:id/pdf-text`) would avoid the 20 KB page
   payload. **Recommendation: lazy fetch. Confirm approach before implementing.**

3. **dxf_thumb.py location in the container**: The spec assumes `admin/` is the
   source root and the build stage copies it to `/app/`. Confirm that
   `admin/scripts/` is not in `.dockerignore` (or excluded by the `ADD admin/ ./`
   instruction's ignore rules).

4. **xvfb concurrent render limit**: If a scan with many `.scad` files runs, each
   `execFileAsync` call spins up a separate `xvfb-run` process. The `--auto-servernum`
   flag prevents collision, but the total Xvfb process count is bounded only by the
   30-second timeout. If this causes memory pressure on the mini with a large SCAD
   library, a concurrency cap (e.g. process at most 2 SCAD files in parallel using
   a simple semaphore) may be needed. **Confirm with a stress test before shipping.**

5. **python3-ezdxf availability on arm64 Debian Bookworm**: Confirm the package
   exists in the arm64 repo before the full rebuild. A quick
   `docker run --platform linux/arm64 node:22-slim apt-cache show python3-ezdxf`
   on the mini verifies this without a full build.

---

## Appendix — patterns to mirror

| Concern | Existing file |
|---|---|
| Shell-out with 30s timeout + `thumbnail_failed` fallback | `StlScannerService.renderThumbnail` (stl / pdf branches) |
| yauzl zip enumeration | `admin/app/jobs/ingest_drug_labels_job.ts` (the Drug Reference ingest — streams the openFDA `.zip` parts via `yauzl`) |
| Lazy `import()` of native modules inside methods | `renderThumbnail` sharp/pdf2pic import pattern |
| Pure helper + unit test (no DB) | `admin/util/file_classification.ts` + `admin/tests/unit/file_classification.spec.ts` |
| apt base-layer addition | Dockerfile line 4 (ghostscript added in #6) |
| Migration varchar column + nullable | `admin/database/migrations/1778459218121_create_stl_files_table.ts` |
