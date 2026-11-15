# November reliability ports

Approved scope: [#81](https://github.com/caweis/project-nomad/issues/81) and [#82](https://github.com/caweis/project-nomad/issues/82). Base: `ea311a8f`. Branch: `codex/november-reliability`.

## Implementation

- [x] Keep renderable Markdoc warnings; preserve fatal validation errors.
- [x] Preserve internal app UI paths and repair Ollama rows overwritten by a port or null.
- [x] Bound default json-file logs on every container create/recreate path, preserving explicit limits and drivers.
- [x] Validate download ranges and GET metadata, keep 2 GiB free, and preserve installed content on interruption.
- [x] Add file-job cancellation/removal endpoints used by the Mac CLI. Count terminal failures correctly and keep delayed retries active in status responses.
- [x] Lock download destinations across processes and bind partials to a hashed source identity. Legacy partials without provenance restart.
- [x] Recover selected regional-map transport failures through GitHub LFS, with fixed endpoints and size/SHA-256 verification before publication.
- [x] Keep browsing usable without model popularity counts and retain curated recommendations with Apple MLX annotations.
- [x] Pin Node 24.22.3 and reproduce/fix Ace command startup with its scoped jsonschema 1.4.1 override.
- [x] Retain disposable offline install/update/uninstall tests. Reject invalid Compose configuration before offline install proceeds.
- [x] Add a production queue-worker smoke test to the validation workflow.

## Validation on macOS arm64

Node 24.22.3 ran the production build and TypeScript check successfully. The build retains Vite's existing large-chunk warning. `sharp`, `@openzim/libzim`, and an in-memory `better-sqlite3` database loaded successfully under that runtime.

Admin validation passed 368 Adonis tests, 4 runner checks and 80 standalone suites. Coverage includes the full configured source inventory, including untested files:

| Surface | Tests | Line/statement coverage |
| --- | --- | --- |
| Admin | 368 Adonis tests, 4 runner checks, 80 standalone suites | 28.00% |
| Translation | 19 | 69% |
| Mesh | 77 | 94% |
| oMLX proxy | 75 | 30% |

Admin branch coverage is 75.88%; function coverage is 21.35%. These percentages do not establish complete behavioral coverage.

All 13 installer shell suites passed, including five new lifecycle scenarios. The collection-URL validator regressions also passed. Host tools and daemon boundaries are stubbed in lifecycle tests; they do not perform a live installation.

The rebuilt production queue worker passed four checks using disposable Redis and a real local HTTP server: exact download bytes, cancellation during streaming, cancellation before pickup, and graceful shutdown. Cancellation preserved installed bytes, removed staging and skipped automatic retries.

Retained regressions were observed failing before their fixes for Markdoc warnings, app paths, range mismatches, abort/disk handling, map MIME validation, concurrent destinations, cross-source partial reuse, late cancellation, retry status, model popularity/MLX fallback, and invalid offline Compose configuration. The real Ace entrypoint reproduced its invalid-URL failure before the scoped override.

Independent reviews found download races and an MLX fallback interaction. Each was verified locally and fixed with a regression before this gate.

## Remaining gates and existing backlog

- The full lint gate fails: 3,325 errors and 5 warnings, compared with 3,334 errors and 5 warnings on unchanged main. ESLint reports no violations on added lines or new files. Existing cleanup is tracked in [#66](https://github.com/caweis/project-nomad/issues/66).
- npm audit reports the same 38 advisories on this branch and its base: 6 high, 31 moderate, 1 low, none critical. The dependency changes introduce no newly flagged package. Triage remains in [#63](https://github.com/caweis/project-nomad/issues/63).
- The Node image manifest includes linux/arm64 and linux/amd64. A full container build was not run because the local Docker daemon was unavailable.
- Installed-app/browser verification remains in [#56](https://github.com/caweis/project-nomad/issues/56). Controller and isolated-database tests verify the path edits and repair migration; no migration was applied to the installed Mac.
- GitHub PR checks remain tracked in [#75](https://github.com/caweis/project-nomad/issues/75). The workflow is updated here; Actions permissions are unchanged.
- Coverage expansion remains in [#68](https://github.com/caweis/project-nomad/issues/68). Existing drafts #74, #77, #78 and #80 remain separate.

See the [parity ledger](../superpowers/audits/2026-09-26-upstream-v1.35-parity.md) for source attribution. This branch is for review; it does not change the installed stack or publish an upgrade image.
