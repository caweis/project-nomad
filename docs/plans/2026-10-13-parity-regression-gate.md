# Parity regression gate implementation plan

> For Codex: execute each step in order, keep the tests that prove a regression, and record actual runner counts.

**Goal:** Verify the merged upstream parity work and make the admin regressions run on every pull request.

**Architecture:** Run the existing unit, standalone, Python, and macOS shell suites before changing behavior. Add one deterministic Node runner for every standalone file and a GitHub Actions job using the supported Node version. For a confirmed defect, add a failing test first, apply the smallest fix, and rerun the focused and full gates.

**Tech stack:** AdonisJS 6, TypeScript, Node 24, Python 3.11, Bash, GitHub Actions.

---

## 1. Baseline and scope

- [x] Record `main` and upstream `main`/`dev` SHAs, and confirm a clean branch.
- [x] Run admin typecheck, production build, Adonis unit suite, and all standalone files; record the actual counts and failures.
- [x] Run the translation Python suite, mesh-service Python suite, URL validator tests, and applicable macOS shell suites with disposable data.
- [x] Record what the local environment cannot exercise. Keep the installed Mac checks in issue #56.

## 2. Durable standalone gate

Files: `admin/tests/run_standalone.mjs`, `admin/package.json`, a focused runner regression test in `admin/tests/standalone/`.

- [x] Write a failing runner test showing that zero discovered files or one failing child process makes the gate fail.
- [x] Implement discovery, deterministic execution, per-file results, and a nonzero-file guard. Report exact suite counts from child exit codes.
- [x] Run the runner test red, then green, and run the complete standalone gate.

## 3. Pull-request CI

Files: `.github/workflows/admin-validation.yml` and any needed test command wiring in `admin/package.json`.

- [x] Add a PR and `main` check using Node 24, `npm ci`, typecheck, production build, Adonis tests, and the standalone gate.
- [x] Validate workflow syntax and run the equivalent commands locally. Confirm a deliberately failing standalone fixture makes the runner return nonzero.
- [x] Push the branch and check the real GitHub Actions result.

## 4. Behavior regressions

- [x] From actual failures or an observed untested parity path, write a focused test that fails on the faulty tree.
- [x] Fix only the confirmed behavior, rerun the new test, and run the affected build and full suites.
- [x] Document any path that still requires a live Mac or a user decision without claiming it passed.

## 5. Review and delivery

- [x] Inspect the diff, run `git diff --check`, and verify test output and counts.
- [x] Commit by scope with Co-Authored-By trailers, push, and open a PR linked to issue #64.
- [x] Add a review section with shipped tests, deferred checks, and exact results.

## Review

Local results from the clean Node 24 install: typecheck and production build pass;
327 Adonis cases, 4 runner regressions, and 79 standalone suites pass. The test
command now exits nonzero when application startup fails before Japa reports cases.
The manpage path regression passes from a directory with spaces. All 12 shell
suites pass, as do 19 translation, 75 mesh, and 69 oMLX proxy Python cases.

Measured source coverage: admin 26.14% statements, translation 69%, mesh 94%,
and oMLX proxy 28%. The workflow uploads admin and Python HTML reports. These
percentages are baselines, not pass thresholds. Installed-device behavior and
container integration remain in issue #56; this gate does not exercise hardware.
Repository-wide lint still reports 3,335 errors and 5 warnings from existing
files; it is tracked in #66 separately from this test gate.

`main` and `origin/main` were `7f00104f` at the final fetch. Upstream `main` and
`dev` were both `54ee30a4`.

PR #67 ran the new workflow on GitHub. Admin, Python, and shell jobs passed.
The CI logs confirm 327 Adonis cases, 4 runner checks, 79 standalone suites,
19 translation tests, 75 mesh tests, and 69 oMLX proxy tests. The existing
macOS shell job also passed. CI reported the same source coverage percentages
as the local runs and uploaded both HTML coverage artifacts.
