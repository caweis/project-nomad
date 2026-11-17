# November 17 upstream maintenance implementation plan

**Goal:** Port applicable Crosstalk development fixes through `35db2978` while preserving macOS and Apple Silicon behavior, then open a tested review PR.

**Architecture:** Keep the fork's native AI transports, no automatic embedding retries, stable vector IDs, guarded downloads and virtualized library. Adapt changes at existing service and UI boundaries. No installed-stack changes are part of this scheduled port.

**Tech stack:** AdonisJS/TypeScript, React/Inertia, libzim, BullMQ, PMTiles, macOS shell and Python services.

## Verified baseline

- Fork main: `5266e8a4515da0153cb4ed52d5ef40e8449170aa`.
- Crosstalk main: `c903da48c97bc02f5cdfeff2ebcde00a82dfec8e`.
- Crosstalk dev: `35db2978b734addd70546b873748e0e4d12fdb4b`.
- Apple Silicon upstream: `5a3f3d1607366b915bd82229c71de028638efc43`.
- Weekly tracker: caweis/project-nomad#4, updated 2026-11-16.

## Tasks

- [x] Read global rules, parity ledger and weekly tracker; fetch and verify upstream heads.
- [x] Port `47c128a5` and `8a8a7b6f` in ZIM extraction, RAG service, embedding continuation and their types. Retain actual bundled-ZIM tests for seek/legacy continuation, complete coverage and invalid resume points. Observe red before applying the fix.
- [x] Port `2875b4aa`/`3e98b2ea` in the existing speed utility, with boundary tests. No production caller or speed UI exists in this fork.
- [x] Port `24e45b95`/`fa0700b1` in Service Logs settings, validation and the fork's shared sidebar. Reuse canonical URL validation, retain current local defaults, and test saving/clearing/rejected schemes.
- [x] Port `4d3d8d76`/`2560587c` map read-only CORS and verify writes remain excluded. The country-extraction paths required by `07d7649e`/`49778a31` are absent; track the feature in #86.
- [x] Triage Intel GPU and non-AVX translation changes against actual Mac/native code; document any non-applicability with source evidence.
- [x] Independently review all contributed patches and merge into this isolated branch.
- [x] Run TypeScript, production build, complete admin coverage/worker smoke, Python coverage and installer/shell regression gates. Distinguish existing lint/advisory limits from new failures.
- [x] Prepare the parity ledger, verification report and scoped changes for a review PR. GitHub publication and checks are recorded on that PR.

## Review

Implementation and local regression gates are complete. See [the verification report](2026-11-17-upstream-maintenance-verification.md) for counts, coverage and failed baseline checks. Dependencies remain in #63, lint in #66, country extraction in #86, frontend types in #87, and installed-device acceptance in #56. No live installation was changed.
