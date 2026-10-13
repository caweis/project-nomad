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

Four local commits cover image references, replacement downloads, URL validation, and dependency updates. The remaining completion-callback reliability defect is tracked in [issue #61](https://github.com/caweis/project-nomad/issues/61). The branch has not been pushed.
