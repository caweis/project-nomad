# November 17 upstream maintenance verification

The review branch starts at fork main `5266e8a4`. Crosstalk main remains `c903da48`, dev is `35db2978`, and proximasan/project-nomad-silicon main remains `5a3f3d16`. The weekly tracker is [#4](https://github.com/caweis/project-nomad/issues/4).

## Ports

- ZIM continuation jobs carry a directory-entry cursor through extraction, RAG and BullMQ. Older queued jobs still accept article offsets and yield during their initial scan. A cursor at EOF completes normally; a cursor beyond the archive fails terminally. Stable vector scopes, collection tags, initial-only legacy purge and disabled automatic retries remain in place.
- Advanced settings stores an optional Service Logs URL using the existing HTTP/HTTPS URL rules. Both sidebars refresh after a successful save. Clearing the field restores the port-9999 default; failed saves show an error.
- Map assets and styles permit anonymous GET/HEAD access, range/cache headers and matching preflights. The other API routes retain the existing CORS policy.
- An Intel-only host using the official Ollama container without Vulkan enabled shows an unsupported-acceleration notice. Native/remote inference, custom containers, Vulkan, unknown/hybrid controllers and Apple Metal retain their existing paths. This is a configuration diagnosis, not a hardware benchmark.
- The existing speed helper chooses units after rounding and rejects non-finite inputs. It has no production callers in this fork, so this port does not change a visible download-speed label.

## Validation

Run on macOS with Node 24.22.3, using disposable Redis and temporary fixtures. The source lockfile is unchanged.

| Check | Result |
| --- | --- |
| Server TypeScript | Passed |
| Production build | Passed; existing Vite large-chunk warning |
| Japa | 475 passed |
| Test-runner checks | 4 passed |
| Standalone suites | 89 passed |
| Real queue worker | 4 passed: startup, download, cancellation and shutdown |
| Admin line/statement coverage | 31.04% (22,231 / 71,614) |
| Admin branch coverage | 73.81% (2,134 / 2,891) |
| Admin function coverage | 27.00% (405 / 1,500) |
| Translation | 19 passed; 69% coverage |
| Mesh | 77 passed; 94% coverage |
| oMLX proxy | 75 passed; 30% coverage |
| Shell/installer | 13 scripts passed, plus collection-URL validator regression |
| Full ESLint | Failed: 3,008 errors and five warnings; baseline has 3,167 errors and five warnings. No diagnostics on added lines/new files. Tracked in #66. |
| Separate frontend TypeScript | Failed: 12 unchanged baseline diagnostics; tracked in #87. |
| Dependency audit | 54 affected packages: 30 high, 23 moderate, one low; none critical. Tracked in #63. These are package counts, not demonstrated exploits. |

The retained additions contain 32 Japa cases and 40 standalone cases. Before the corresponding fixes, ZIM tests had seven failures, map CORS five, Intel GPU one, speed formatting eight, and Service Logs 25. Final suites pass.

The real bundled archive test compares all extracted chunk text, metadata and IDs against whole-archive extraction, then checks the complete continuation chain. It covers 101 accepted HTML articles across 5,054 directory entries. A real HTTP server verifies ranged map bytes, cache headers and empty preflight responses.

Independent source review found no confirmed regression. Supplemental reviewer tests passed; those ran on Node 26.11.1 and are not substituted for the lead's complete Node 24 gate. The dedicated TypeScript reviewer stopped at the existing full-lint failure and gave no source approval; a separate code reviewer completed the source analysis.

## Limits and follow-up

- Country-based map extraction is absent in this fork. The estimate timeout and cancellation patches depend on that feature; its port is tracked in #86.
- The x86 Bergamot AVX-import fix does not apply to the fork's ARM64 CTranslate2 translation image. Linux mount/port preflight patches target the upstream installer, outside this fork's supported Mac CLI. The FAQ change only reflows an upstream paragraph absent from the Mac FAQ.
- No browser visual pass, physical GPU probe or installed-stack upgrade was performed. Persistence and embeddings in the new focused tests use isolated adapters. The existing real-worker test uses disposable Redis. Device acceptance remains in #56 and the experimental Mac benchmark in #76.
- Cursor validation checks directory bounds; it does not verify archive identity. Stable IDs and the existing indexing lifecycle remain unchanged.
- GitHub checks are reported on the review PR. These local results do not assert a CI result or publication to an installed Mac.
