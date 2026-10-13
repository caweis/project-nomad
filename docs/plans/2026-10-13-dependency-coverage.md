# Dependency audit and coverage implementation plan

> For Codex: verify advisory paths and real behavior before changing dependencies or adding tests.

**Goal:** Reduce actionable admin dependency advisories and raise measured coverage with regressions that protect real behavior.

**Architecture:** Audit the checked-in npm lockfile against the live advisory feed, trace the dependency chains and runtime call sites, then apply compatible updates in a disposable Node 24 install. Add focused red tests for consequential uncovered code, run the full repository gate, and record the measured change.

**Tech stack:** AdonisJS 6, Node 24, npm, TypeScript, Python 3.11, Bash, GitHub Actions.

---

## 1. Baseline and audit

- [x] Confirm clean `main`, read issues #63 and #68, and reproduce the npm audit totals.
- [x] Trace each advisory to the package that pulls it in and identify production exposure, safe fixes, and major-version blockers.
- [x] Capture current coverage per source file and select consequential gaps.

## 2. Dependency updates

- [x] In a disposable Node 24 install, try Dockerode 5 and its transitive dependency removal.
- [x] Re-run the audit after the update and compare the exact remaining advisories.
- [x] Copy only verified manifest and lockfile changes into the branch.

## 3. Red regressions and coverage

- [x] Add focused failing tests for malformed JSON shape in the oMLX proxy and incomplete admin downloads.
- [x] Confirm each test fails for the intended reason against the old behavior.
- [x] Apply the smallest fix, then verify focused tests pass and a complete download still succeeds.
- [x] Re-measure coverage and retain tests in the repository.

## 4. Full gate and delivery

- [x] Run admin typecheck, build, all Adonis and standalone tests with coverage, Python suites, and shell regressions.
- [x] Inspect lint status, security audit, diff, and any untested hardware paths; report the actual counts.
- [ ] Commit by scope after fetching the branch tip, push, open a PR, check CI, and merge after the gate passes.
- [ ] Record shipped work and deferred blockers in this plan and the relevant GitHub issues.

## Review

The lockfile trial installed Dockerode 5.0.1 and removed `uuid` 10.0.0. The
fresh npm audit fell from 29 findings (14 high, 15 moderate) to 27 (14 high,
13 moderate). Those 27 package entries derive from five advisory roots:
Adonis core and HTTP server, Faker, `braces`, and `sprintf-js`. The Adonis
fixes require a coordinated major-version migration. Faker 10.5.0 is patched,
but Lucid 21 requires Faker 9, so forcing the major override was deferred.
`braces` and `sprintf-js` have no patched release. The application has no
direct calls to the affected Adonis redirect builders or Faker helper; glob
packages are used by build tooling, while Mammoth is used for DOCX text
extraction. Issue #63 remains open for those dependency families.

Two admin download regressions failed before the fix: an unsolicited HTTP 206
response and a short HTTP 200 body were both published as complete files. A
valid full response passes. The oMLX proxy previously accepted scalar and array
JSON, causing callers that expect an object to raise outside their parse-error
guard. The new route regression failed with `AttributeError` before the fix and
now returns HTTP 400.

Final local gate on Node 24: admin typecheck and production build pass; 330
Adonis cases, 4 runner checks, and 79 standalone suites pass. Source statement
coverage rose from 26.14% to 26.38% for admin and from 28% to 30% for the oMLX
proxy. Python suites pass: 19 translation, 75 mesh, and 75 oMLX cases. All macOS
shell regressions pass. Focused ESLint on changed admin source and tests passes;
repository-wide lint still fails with 3,335 pre-existing errors and 5 warnings
(issue #66). Installed Mac and hardware checks remain in issue #56.

PR and CI review are pending.
