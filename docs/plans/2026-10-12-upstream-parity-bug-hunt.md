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

The new standalone test reproduced the same-size retry gap before the fix, then passed all four cases afterward. The admin build and TypeScript compile passed in the isolated Node 24 checkout. The ingest-decision suite passed 11 cases; targeted lint passed for the changed download job, download utility, types, and decision helper. Repository-wide lint and the Adonis runner still need their existing baseline and Redis prerequisites resolved; no live macOS download was run. Commit `cfaeef89` is pushed and draft PR #62 describes the result.
