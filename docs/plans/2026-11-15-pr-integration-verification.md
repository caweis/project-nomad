# PR integration verification — 2026-11-15

This branch combines #74, #77, #78, #80, and #83 on main at ea311a8f. It preserves macOS and Apple Silicon support, passwordless local administration, local-only Score v2, and the experimental Mac v2 label.

The three fork ideas are included: Git LFS regional-map recovery with size and SHA-256 verification, model browsing when popularity counts are missing, and installer lifecycle tests covering installation, updates, uninstall, and offline operation.

## Integration fixes

- Keep completed legacy embedding batches when an upgrade resumes a queued continuation. Purge old random-ID points only when indexing starts from the beginning.
- Disable BullMQ stalled retries for embeddings as well as ordinary failed attempts. Persist terminal failure to job data and the knowledge-base state independently.
- Load installed maps without waiting for world-map extraction. The Map Settings action still provisions the world basemap.
- Preserve the selected Wikipedia library when an unrelated curated corpus finishes downloading. Keep mirror filename matching and selected custom filenames.
- Restore Open on native Ollama and oMLX cards, including custom URL overrides.
- Retain download integrity checks and destination locking alongside connection-time DNS guards for both HEAD and GET.

New regressions failed before their corresponding fixes and passed afterward. The real-worker fixture now uses a private IPv4 interface so it exercises production URL checks without a DNS override.

## Validation

| Check | Result |
| --- | --- |
| Node runtime | 24.22.3 |
| TypeScript | Passed |
| Production build | Passed; existing Vite chunk-size warning remains |
| Adonis tests | 443 passed |
| Test-runner regressions | 4 passed |
| Standalone suites | 87 passed |
| Admin coverage | 30.20% lines/statements; 74.62% branches; 25.65% functions |
| Installer/shell checks | 13 scripts and collection-URL validator regression passed |
| Translation | 19 passed; 69% coverage |
| Mesh | 77 passed; 94% coverage |
| oMLX proxy | 75 passed; 30% coverage |
| Catalog URLs | 116 passed initially; the timed-out Alaska URL returned 200 on retry |
| ARM64 container | Built; sharp, libzim, SQLite and PMTiles 1.30.2 loaded successfully |
| Disposable database | 58 migrations applied; five built-in mirrors present; Ollama points to /chat |
| Real download worker | Download, cancellation, installed-file preservation and shutdown passed |
| Real stalled embedding | Failed without invoking the embedding processor; Redis and MySQL recorded failure |
| LAN mirror | Added and browsed through the API; bundled ZIM downloaded with identical SHA-256 and appeared in the library XML |
| Preview routes | Supply Depot returned its page data with 15 services; legacy Apps redirected; library explorer returned 200 |

## Remaining limits

Full-repository ESLint still fails with 3,167 errors and five warnings. None falls on added lines or new files in this integration. The existing lint backlog is tracked in #66. The dependency audit remains at 38 advisories: six high, 31 moderate and one low, tracked in #63.

Local browser access was unavailable, so no visual browser pass was completed in this session. Installed-device acceptance remains tracked in #56; the experimental Mac benchmark follow-up is #76. No live installation was upgraded during this verification. GitHub build publication must be checked after merging; local tests are not GitHub CI results.
