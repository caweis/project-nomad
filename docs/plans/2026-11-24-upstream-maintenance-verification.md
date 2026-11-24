# November 24 upstream maintenance verification

This follow-up extends PR #88. It compares Crosstalk main `f633b36e` and dev `fcca88cd` with fork main `5266e8a4`. Apple Silicon upstream remains `5a3f3d16`. The parity ledger records the treatment of all 11 new commits and 28 equivalent rewritten patches.

## Changes

- Map CORS requires both the original route and its decoded, normalized path to remain in the map namespace. Error responses lose anonymous read access. Tests exercise real static HTTP responses and the router/controller with fixture data.
- Five renamed catalog resources retain their installed files and update settings. Catalog publication and alias migration are atomic. Download checkpoints are saved outside SQL transactions, then the selected predecessor and catalog policy are revalidated before publishing. Download, callback and startup reconciliation regressions cover stale editions and overlapping work.
- A narrow migration repairs the completed unknown Wikipedia Medicine selection left by an older preview. It preserves files, named selections and custom or ambiguous catalog state.
- Scheduled and manually triggered catalog checks on main report failures in one issue and close it on recovery. Retained tests exercise the actual workflow conditions, concurrency grouping and failure propagation.
- Community links use the maintained Discord redirect. The retired React documentation archive is replaced with the November edition, and the Medicine download estimate is corrected from the published byte length.

## Validation

Run on macOS with pinned Node 24.22.3, disposable Redis and temporary fixtures. The lockfile is unchanged.

| Check | Result |
| --- | --- |
| Server TypeScript and production build | Passed; existing Vite large-chunk warning |
| Full admin tests | 529 Japa cases, four runner checks and 90 standalone suites passed |
| Admin line/statement coverage | 32.30% (23,263/72,004) |
| Admin branch coverage | 74.49% (2,407/3,231) |
| Admin function coverage | 30.05% (458/1,524) |
| Real queue worker | Four checks passed: startup, download, cancellation and shutdown |
| Translation | 19 passed; 69% coverage (281/408 statements) |
| Mesh | 77 passed; 94% coverage (441/470 statements) |
| oMLX proxy | 75 passed; 30% coverage (879/2935 statements) |
| Shell/installer | 13 scripts passed, plus both catalog script regressions. One reset-ollama assertion skipped because the real NOMAD drive is mounted. |
| Live catalog URLs | 117 checked, zero failed |
| Full ESLint | Failed: 3,005 errors and five warnings; no diagnostics on new or added lines. November 17 had 3,008 errors and five warnings. Tracked in #66. |
| Separate frontend TypeScript | Failed: 12 diagnostics identical to the November 17 result; tracked in #87 |
| Dependency audit | 38 affected packages: six high, 31 moderate, one low; none critical. Tracked in #63. |

The Python and installer source inputs are unchanged from their complete suite runs. The workflow addition was checked separately. The dependency count is a fresh advisory snapshot on the same lockfile, not evidence of dependency remediation.

## Regression evidence and limits

The retained additions bring the Japa total from 475 to 529 and standalone suites from 89 to 90. Admin line coverage increases from 31.04% to 32.30%. Red-to-green evidence covers map route boundaries, preview selection repair, renamed resources, guarded cleanup, stale download completion, startup overlap and paused/rejected queue checkpoints. The workflow regression also fails against the old concurrency group; the shell regression fails when its reporter is deliberately changed to produce the wrong outcome.

Independent review reproduced four full-worker/startup failures and three checkpoint overlap failures. The corrected integrated source passed the reviewer's eight unchanged cases. All confirmed findings in the assigned changes were resolved. The dedicated TypeScript reviewer stopped at the existing lint failure and did not provide code-level approval; a separate code reviewer completed source analysis. Neither review replaces the lead's complete suite run.

The new database tests run application migrations and services against temporary SQLite databases and real temporary files. They do not establish MySQL contention behavior on an installed Mac. No installed stack, live user database, release version or existing feature choices were changed. Device acceptance remains in #56, coverage follow-up in #68, and the earlier country-extraction feature decision in #86.

GitHub results are recorded on PR #88 after publication; local results do not assert a hosted CI result.
