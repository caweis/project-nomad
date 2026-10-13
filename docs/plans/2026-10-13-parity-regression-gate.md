# Parity regression gate implementation plan

> For Codex: execute each step in order, keep the tests that prove a regression, and record actual runner counts.

**Goal:** Verify the merged upstream parity work and make the admin regressions run on every pull request.

**Architecture:** Run the existing unit, standalone, Python, and macOS shell suites before changing behavior. Add one deterministic Node runner for every standalone file and a GitHub Actions job using the supported Node version. For a confirmed defect, add a failing test first, apply the smallest fix, and rerun the focused and full gates.

**Tech stack:** AdonisJS 6, TypeScript, Node 24, Python 3.11, Bash, GitHub Actions.

---

## 1. Baseline and scope

- [ ] Record `main` and upstream `main`/`dev` SHAs, and confirm a clean branch.
- [ ] Run admin typecheck, production build, Adonis unit suite, and all standalone files; record the actual counts and failures.
- [ ] Run the translation Python suite, mesh-service Python suite, URL validator tests, and applicable macOS shell suites with disposable data.
- [ ] Record what the local environment cannot exercise. Keep the installed Mac checks in issue #56.

## 2. Durable standalone gate

Files: `admin/tests/run_standalone.mjs`, `admin/package.json`, a focused runner regression test in `admin/tests/standalone/`.

- [ ] Write a failing runner test showing that zero discovered files or one failing child process makes the gate fail.
- [ ] Implement discovery, deterministic execution, per-file results, and a nonzero-file guard. Report exact suite counts from child exit codes.
- [ ] Run the runner test red, then green, and run the complete standalone gate.

## 3. Pull-request CI

Files: `.github/workflows/admin-validation.yml` and any needed test command wiring in `admin/package.json`.

- [ ] Add a PR and `main` check using Node 24, `npm ci`, typecheck, production build, Adonis tests, and the standalone gate.
- [ ] Validate workflow syntax and run the equivalent commands locally. Confirm a deliberately failing standalone fixture makes the runner return nonzero.
- [ ] Push the branch and check the real GitHub Actions result.

## 4. Behavior regressions

- [ ] From actual failures or an observed untested parity path, write a focused test that fails on the faulty tree.
- [ ] Fix only the confirmed behavior, rerun the new test, and run the affected build and full suites.
- [ ] Document any path that still requires a live Mac or a user decision without claiming it passed.

## 5. Review and delivery

- [ ] Inspect the diff, run `git diff --check`, and verify test output and counts.
- [ ] Commit by scope with Co-Authored-By trailers, push, and open a PR linked to issue #64.
- [ ] Add a review section with shipped tests, deferred checks, and exact results.

## Review

Pending.
