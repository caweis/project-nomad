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

## Follow-up: preserve chat text on session failure (2026-10-13)

The chat handler waits for session creation before showing the user's message.
The API wrapper returns `undefined` when that request fails, so the handler
returns without showing the text or a failure state. Upstream `fa34d6df`
fixes the same call order.

- [x] Render the user message before awaiting session creation.
- [x] Show an actionable assistant error when creation returns no session or throws.
- [x] Build, typecheck, run the configured unit suite, inspect the diff, and commit.

### Review

The source now calls `setMessages` before the session request and appends a
visible error if the request fails or returns no session. Typecheck and the
production build pass in the isolated checkout. The configured Adonis suite
passes 287 tests. This codebase has no chat component test harness; interactive
verification of the failure state remains pending. ESLint ignores this TSX
file under the current config, and Prettier reports formatting differences in
untouched portions of the file.
Commit `0b85ad29` contains the chat change locally. The browser failure state
has not been exercised against a running admin instance.

## Follow-up: offline library translation (2026-10-13)

Chris chose to include upstream offline translation while retaining Apple
Silicon support. Trace the upstream service, model acquisition, image build,
admin route, and installer path before porting. Keep the translation service
local to the NOMAD stack and verify model and image architecture requirements.

The upstream Bergamot 0.4.5 image targets amd64. Its source build hardcodes an
SSE flag and fails on arm64. A native arm64 CTranslate2 image loaded an Argos
English-to-French model and translated a sentence locally. Use that engine for
the Mac image. It translates text nodes so article tags and link targets remain
byte-for-byte intact. Pin the initial model archives and validate extraction.
The catalog names a versioned image that must be published before release.

- [x] Compare upstream translation implementation and dependencies with this fork.
- [x] Add the arm64 image build and Supply Depot/macOS update wiring.
- [x] Port the application flow and add focused regression coverage.
- [x] Run build, tests, image validation, and installer checks; document any live limits.

### Review

The arm64 image built locally. The first-start container downloaded and
verified the pinned French model under a read-only root filesystem and served
a translated fixture article. Separate Spanish and German model packages
translated the same sentence in an arm64 container. The final proxy's language
link set a cookie and redirected back to the translated page. A real ZIM page
returned translated HTML, with all 106 original link targets and script bodies
unchanged. An 8 MB asset and an oversized 5 MB HTML response were byte-identical
through the proxy. The Python suite passes 19 tests, including an entity form
that previously made text spans overlap.

The admin build and typecheck pass. The configured Adonis suite passes 287
tests. `bash -n install/macos/nomad` passes, and the update helper suite passes
16 checks, including reseeding on admin and full-stack upgrades. Targeted
ESLint still reports nine pre-existing Prettier errors in the seeder's
reseed block; the added lines produce none. The image has not been published,
and the live NOMAD stack was not changed.

## Follow-up: keep knowledge-base toggles consistent on Qdrant failure (2026-10-13)

The fork writes the ingest-state active flag before updating Qdrant. If the
Qdrant update fails, the API reports an error but the saved flag still changes.
The next panel read can therefore disagree with retrieval. Adapt upstream
`c65198c7` to the fork's file and named-collection behavior.

- [x] Reproduce file and collection failure paths with service-level tests.
- [x] Restore only flags changed by the failed operation; preserve a later
      concurrent change when restoring.
- [x] Run affected tests, typecheck, build, review the diff, and commit.

### Review

Both regression tests failed against the prior service code with the saved
flag still changed after a simulated Qdrant failure. They pass with the fix.
The full Adonis unit suite passes 289 tests across 19 spec files. TypeScript
typecheck and the production build pass. The new test file passes ESLint and
Prettier; `rag_service.ts` retains existing style errors outside the changed
logic. The Qdrant failure was simulated in a service-level test; no live
knowledge-base data was changed.

## Follow-up: validate map preflight redirects (2026-10-13)

The map preflight checks its starting URL, then sends a HEAD request through
Axios without the redirect callback used by the download path. A redirect
therefore bypasses the destination check before the download job begins.

- [x] Test the preflight request's redirect callback and timeout.
- [x] Reuse the existing redirect guard for preflight.
- [x] Run the unit suite, typecheck, build, inspect the diff, and commit.

### Review

The new preflight test fails against the prior request and passes when the
request uses the existing redirect guard. The production build and TypeScript
typecheck pass. The full Adonis suite passes 290 tests from 20 spec files.
The test file passes ESLint; the map service has existing lint findings outside
the changed request. The test uses a mocked HEAD request and did not fetch a
remote map or change the live stack.

## Follow-up: integrate the fork's existing v1.35 parity branch (2026-10-13)

The fork had 21 unmerged commits on `claude/busy-babbage-apnxan` covering chat
pictures, upload cleanup, branding, and other v1.35 changes. Preview the merge
in an isolated worktree. Keep the native ARM64 translation implementation and
the verified fixes on this branch when resolving overlap.

- [x] Merge the existing branch in a temporary worktree and audit every conflict.
- [x] Run the full affected build and test gates, plus checks for the merged
      features' wiring and Mac update script.
- [x] Fast-forward the PR branch to the verified merge commit and update the PR.

### Review

Merge commit `de1573fb` retains the fork's ARM64 translation service and the
verified download replacement path while bringing in the existing v1.35 chat,
container, and documentation work. The full standalone sweep caught a broken
Translated Library documentation anchor; the map now points to the heading
present in the page. All 78 standalone files pass after that correction.

The merged tree passes TypeScript typecheck, the admin production build, 290
Adonis unit tests from 20 files, 19 translation tests with Python 3.11, and 16
Mac update checks. Shell syntax and catalog JSON validation pass. Focused lint
on the new helpers passes. Repository-wide lint remains red with 3,364
findings, compared with 3,365 on the PR branch before the merge. The build
prints an existing Node deprecation warning and a Vite chunk-size warning.

The native translation container and a real Kiwix article were tested locally
before the merge. The registry image has not been published, and the merged
admin UI and installer have not been exercised on a live Mac installation.

## Follow-up: resolve flavoured ZIM catalog entries (2026-10-13)

Upstream `f63adb8a` retries a catalog lookup with the book name before its
flavour suffix. The fork's curated downloader queries only the full resource
ID, so a catalog that indexes `wikipedia_en_medicine_maxi` under
`wikipedia_en_medicine` can leave the pinned URL stale.

- [x] Reproduce the missed lookup and an unrelated first catalog entry in a
      service-level test.
- [x] Retry with the base name and select the newest filename that matches the
      original resource ID.
- [x] Run the full unit suite, standalone suite, typecheck, build, and relevant
      lint; review the diff and update draft PR #62.

### Review

The focused test first failed because the service requested only the full
flavoured ID. It now retries with the base name, accepts a single or repeated
OPDS link, and chooses the newest dated filename that still matches the full
ID. Both focused cases pass. The full Adonis suite passes 292 tests from 21
spec files. All 78 standalone files, TypeScript typecheck, and the admin
production build pass. The new test file passes ESLint; `zim_service.ts` still
has 19 lint findings outside this change. The test used a local catalog
fixture; it did not fetch a live catalog or change installed libraries.
Commit `6b5ec700` holds the code and test.

## Follow-up: report failed model pulls accurately (2026-10-13)

The installed Ollama client already throws on in-band stream errors, so the
fork does not need upstream's stream parser. The service still returns success
after a completed stream without checking that the model appeared in Ollama's
installed list. The queue also retries a known missing model on its fixed
40-attempt schedule.

- [x] Reproduce a clean stream with no installed model and a permanent missing
      model error in focused service and job tests.
- [x] Verify the installed model before reporting success; classify a missing
      model as nonretryable for the job while keeping transient failures retryable.
- [x] Run the full test, build, typecheck, and lint gates; review the diff and
      update draft PR #62.

### Review

All four initial regressions failed against the prior service and job. The
final suite adds a transient connection case; all five pass. The Ollama client
already raises an exception for an in-band error frame, so the fix verifies
the installed model after the stream and passes a permanent-failure signal to
BullMQ. The full Adonis suite passes 297 tests from 22 spec files. All 78
standalone files, TypeScript typecheck, and the admin production build pass.
The new test file passes ESLint; the changed service and job retain 19 older
lint findings outside the new logic. No live model pull was run. Commit
`37af3ca0` holds the code and tests.

## Follow-up: patch the image decoder dependency (2026-10-13)

At the start of this follow-up, the admin lockfile carried `sharp` 0.34.5.
The dependency audit flagged its bundled image libraries as high severity.
Chat uploads, RAG image preprocessing, and STL thumbnails all call this
decoder. The upgrade must
preserve the Apple Silicon image path and the current JPEG/PNG/WebP limits.

- [x] Confirm the patched release and inspect each production `sharp` call for
      changed APIs or defaults.
- [x] Update only `sharp` and its lockfile dependencies in an isolated checkout.
- [x] Decode real image fixtures, run the affected tests, typecheck, build, and
      a fresh dependency audit. Check Linux ARM64 packages in the lockfile.
- [x] Review the exact diff, commit the verified change, and update draft PR
      #62 and issue #63 with the remaining advisory count.

### Review

The update changes `sharp` 0.34.5 to 0.35.5 and its optional native packages;
the lockfile includes macOS and Linux ARM64 builds. A clean `npm ci` succeeds
on Node 24. The chat image tests pass 24 cases, the upload checks pass nine,
and a direct RAG and thumbnail image conversion succeeds. The full Adonis
suite passes 297 tests, all 78 standalone files pass, and the production
build and TypeScript typecheck pass. The build retains its existing large
chunk warning. The audit now reports 31 advisories (15 high, 16 moderate,
none critical) and no `sharp` advisory; 30 are present with `--omit=dev`.
The first install attempt used this host's unsupported Node 26 and failed in
`better-sqlite3`; retrying with Node 24 succeeded. The first local upload
test attempt hit the sandbox's bind restriction; it passed outside that
sandbox. No live Docker image or Mac installation was exercised.
Commit `73d934a2` is pushed. Draft PR #62 and issue #63 carry the current
audit count. The PR's validate and shell checks pass; publish is skipped on
the draft PR.

## Follow-up: update the drug import JSON parser (2026-10-13)

At the start of this follow-up, `stream-json` was 1.9.1. Its Pick filter
handles records from the downloaded drug reference archive, and the dependency
audit reports three advisories on this version. Version 3 uses ESM exports and
different subpaths. This job previously stalled when an import returned an
undefined factory, so test the real parser chain rather than the package name.

- [x] Write a focused streaming fixture that uses the production parser,
      Pick, and array streamer and confirms record values and error delivery.
- [x] Install a patched version and adapt only the import path needed by the
      existing pipeline.
- [x] Run the focused fixture, full standalone and Adonis suites, typecheck,
      build, and fresh audit; inspect the lockfile diff for unrelated churn.
- [x] Review, commit, push, and update PR #62 and issue #63 with the result.

### Review

The new fixture passed with `stream-json` 1.9.1. After the 3.7.0 install, it
failed because the old `StreamArray.js` subpath no longer exists. The job now
loads v3's ESM factories and uses their Node stream wrappers. The fixture
passes three cases: records split across input chunks, malformed JSON errors,
and a `__proto__` key that does not change the record prototype. The obsolete
v1 type package is removed. A clean `npm ci` succeeds on Node 24.

The Adonis suite passes 297 tests. The first standalone gate failed because
the concurrent build removed a compiled fixture while it ran; all 79 files
passed when the build finished before the sweep. TypeScript typecheck and the
production build pass. The new helper and fixture pass ESLint and Prettier.
The drug ingest job still reports 246 ESLint errors; its two unused suppression
warnings were removed. The audit reports 30 remaining advisories (15 high,
15 moderate, none critical) and no `stream-json`
advisory. No live drug import or Mac installation was run.
Commit `1a6f8fba` is pushed. Draft PR #62 and issue #63 reflect the 30-advisory
count, and the PR's validate and shell checks pass. The production-only audit
reports 29 advisories (14 high, 15 moderate).

## Follow-up: remove an unused development dependency (2026-10-13)

The admin package declares `hot-hook` as a direct development dependency.
No source, script, or config file references it. Its `fast-glob` path is
flagged in the dependency audit. Remove the unused direct dependency and
check whether the lockfile and audit lose that path.

- [x] Remove `hot-hook` from the development dependencies and lockfile.
- [x] Run a clean install, typecheck, production build, affected test suites,
      and fresh audit. Compare the lockfile against the prior tree.
- [x] Review, commit, push, and update draft PR #62 and issue #63.

### Review

The removal deletes `hot-hook` and packages used only by it; it does not
change versions of other dependencies. A clean Node 24 `npm ci`, TypeScript
typecheck, and production build pass. The Adonis suite passes 297 tests and
all 79 standalone files pass. The audit reports 29 remaining advisories
(14 high, 15 moderate, none critical); `hot-hook` is no longer flagged.
No live Mac installation was run.
Commit `bc5c049d` is pushed, and draft PR #62 and issue #63 show the updated
audit count. The shell check passes; validation is still pending at this
recorded point.

## Security reporting and local credential files

**Scope:** Adapt upstream `fb919690` for this fork. The Command Center stays
password-free as Chris requested, and the tracked macOS Compose file remains
visible to Git.

- [x] Enable and verify private vulnerability reporting on the fork.
- [x] Add a fork-specific security policy, issue chooser link, and README
      explanation of the local-network trust boundary.
- [x] Ignore local credential and root Compose overrides without hiding
      `install/macos/compose.yaml` or `admin/.env.example`.
- [x] Verify ignore behavior, Markdown links, build and tests, then review,
      commit, push, and update draft PR #62.

### Review

The fork's private vulnerability reporting API returns `enabled: true` after
the setting change. Git ignore assertions pass for six sample credential or
override paths and three preserved paths; the macOS Compose file and admin
environment example remain tracked. The issue chooser YAML parses, and the
README and security-policy links match the fork's private reporting URL.
The earlier code gate on this same tree passed the Node 24 typecheck and
production build, 297 Adonis tests, and 79 standalone files. This action
changes documentation and ignore rules, not runtime code or dependencies.
Repository-wide lint remains red from existing errors. Commit `4b56d038`
is pushed, draft PR #62 reflects the change, and its validation and shell
checks pass.

## Batch orphan cleanup without losing retries

**Scope:** Adapt upstream `2cc3ce9b`. The fork's orphan sweep removes state
before vectors so a failed Qdrant deletion remains discoverable on the next
scan. Keep the replacement and user-requested delete paths separate.

- [x] Batch orphan state deletion into one query and vector deletion into one
      `match.any` request, with an empty-input guard.
- [x] Make the single-source caller use the same orphan path; keep failures
      logged and retryable.
- [x] Test call count, filter shape, ordering, failure retry, and empty input.
- [ ] Run targeted and full gates, inspect the diff, then commit, push, and
      update draft PR #62 and the parity ledger.

### Review

The first targeted Adonis run could not bind its local test port in the
sandbox. It printed `EPERM` while returning exit code zero, so no tests from
that attempt count. The rerun with socket access passed four new cases; a
fifth case then covered a failed state query. Node 24 typecheck and production
build pass, followed by 302 Adonis tests
across 23 spec files and all 12 standalone orphan-decision checks. Focused
lint and formatting for the new test pass. The code keeps the prior
state-first ordering for orphans and leaves user-requested and replacement
deletes unchanged. No live Qdrant or installed Mac stack was exercised.
Publication is pending.
