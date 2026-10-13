# Upstream parity and bug hunt implementation plan

> **For Codex:** Work through the checks in order; verify each claim against the current fork and `upstream/main`.

**Goal:** Preserve the macOS distribution while closing confirmed upstream parity gaps and reproducible defects.

**Architecture:** Port the download replacement decisions into small, tested helpers and keep filesystem deletion bounded to the resource's storage root. Use the fork's existing `RagService` and queue integration. Treat other bug candidates as findings until a concrete failure path is confirmed.

**Tech Stack:** AdonisJS 6, TypeScript, Node standalone tests, Bash macOS installer.

---

## Tasks

- [x] Clone `caweis/project-nomad`, fetch `Crosstalk-Solutions/project-nomad`, read the v1.35 ledger and open parity issues.
- [x] Trace the download replacement path, its callers, the ingest state schema, and the upstream implementation.
- [x] Add failing standalone tests for old-file path confinement and knowledge-base replacement decisions.
- [x] Port the bounded delete and replacement reconciliation from upstream, adapted to the fork's macOS paths and ingestion state.
- [x] Reproduce and fix the image-reference parser defect in issue #46 with a failing standalone test.
- [x] Hunt data-loss and security paths across installer, downloads, and admin routes; classify each candidate with source-backed evidence.
- [x] Run affected tests, TypeScript typecheck, lint, build, and review the diff. Verify test counts and record any environment limits.
- [x] Commit each verified fix by scope and record the result below.

## Review

The admin production build and TypeScript typecheck pass in a no-space temporary checkout with Node 24 and the branch's source and lockfile. Four standalone suites pass: 7 image-reference cases, 6 path cases, 11 ingest-decision cases, and the video catalog check. Targeted lint passes for the new helpers, parser, URL guard, and URL-guard tests. Repository-wide lint reports thousands of formatting and style errors, including errors in untouched files. The Adonis URL-guard assertions pass individually, but the runner cannot finish without Redis. The dependency audit fell from 64 to 32 advisories, with no critical findings; 16 moderate and 16 high advisories remain. A live macOS install and map interaction have not been run.

The changes are published in [draft PR #62](https://github.com/caweis/project-nomad/pull/62). [Issue #61](https://github.com/caweis/project-nomad/issues/61) is addressed by the follow-up below and will close when the PR merges. No CI checks were reported on the branch when the PR was opened.

## Follow-up: finish issue #61 (2026-10-13)

Chris chose to keep the admin page password-free. This plan does not add admin authentication.

- [x] Reproduce callback rejection and the same-size-file retry gap in a focused test.
- [x] Make the download promise reject when completion work fails, and permit a failed job to resume completion against a verified existing file.
- [x] Persist the prior resource path and indexing decision before replacing the InstalledResource row, so BullMQ and manual retries preserve them.
- [x] Run targeted tests, build/typecheck/lint, inspect the diff, then commit and update draft PR #62.

### Review

The new standalone test reproduced the same-size retry gap before the fix, then passed all four cases afterward. The admin build and TypeScript compile passed in the isolated Node 24 checkout. The ingest-decision suite passed 11 cases; targeted lint passed for the changed download job, download utility, types, and decision helper. Repository-wide lint remained red; the Adonis test gate was repaired in the follow-up below. No live macOS download was run. Commit `cfaeef89` is pushed and draft PR #62 describes the result.

## Follow-up: restore the Adonis test gate (2026-10-13)

The installed Node 24 runtime matches zero files for the existing `*.spec(.ts|.js)`
patterns. `npm test` can consequently exit successfully after running no tests.
With corrected patterns in an isolated copy, 282 unit assertions ran: 280 passed,
one exposed a comparison-ID parser defect, and one assertion contradicted the
documented section-trimming behavior. The Redis-backed Transmit transport also
raises a connection-close error during test teardown.

- [x] Correct spec discovery and add a guard against an empty test run.
- [x] Reject decimal/scientific ID syntax while preserving valid positive IDs.
- [x] Align the drug-label whitespace assertion with the documented behavior.
- [x] Keep Transmit's Redis transport out of the single-process test environment.
- [x] Run the full unit suite, standalone regressions, build, typecheck, and targeted lint.
- [x] Review and commit the verified fixes, then update draft PR #62.

### Review

`npm test -- --no-assets` now discovers 17 spec files and runs 283 unit
assertions with 283 passing. The pretest guard fails if the unit glob matches
no files. Node 22.23.3 supports the guard's brace glob, checked against the
installed app's runtime. TypeScript typecheck, the admin production build,
targeted ESLint, and Prettier checks pass. The production Transmit transport
remains Redis-backed; only the test environment uses no cross-process bus.
The five focused standalone suites pass (4 download completion, 11 ingest
decisions, 7 image references, 6 path checks, and the video catalog). The
configured Adonis run also passes after the temporary Redis container was
removed; this checkout has no functional spec files. Commit
`9a8b6844` contains the test-gate and parser changes.

## Follow-up: protect empty knowledge-base roots (2026-10-13)

Upstream `ae1eae78` identified a mount failure that leaves a present but empty
ZIM directory. The fork's current whole-scan guard allows a non-empty uploads
root to make every indexed ZIM under that empty directory look deleted.

- [x] Test empty, missing, partial, and healthy roots as separate decisions.
- [x] Withhold deletion for a root with no embeddable files or a mass-removal signal.
- [x] Keep file-presence checks against all files found, including types no longer recognized for embedding.
- [x] Report withheld roots in the sync result while preserving valid orphan cleanup.
- [x] Run standalone tests, Adonis tests, typecheck, build, targeted lint, and inspect the diff.
- [x] Commit and update draft PR #62.

### Review

The old helper passed a test that expected an empty but present ZIM root to
lose its vectors; a new regression first failed with that exact result. The
per-root decision now withholds that purge, and also withholds a removal of
more than half a root's indexed sources when at least five are missing. The
standalone sweep suite passes 12 cases. The configured Adonis run passes 287
tests from 18 spec files after the production build. Typecheck passes, and
targeted lint passes for the new helper and tests; `rag_service.ts` and the
repository still have pre-existing lint errors. Commit `be9750a1` is pushed
to draft PR #62. No live knowledge-base sweep was run.
