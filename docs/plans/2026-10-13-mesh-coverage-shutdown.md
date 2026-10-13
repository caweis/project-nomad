# Mesh worker shutdown regression plan

> For Codex: follow the debugging evidence before changing the worker lifecycle.

**Goal:** Remove the mesh responder thread leak seen at the end of the CI test process and verify whether it resolves the intermittent coverage crash in issue #70.

**Architecture:** The FastAPI lifespan starts one responder thread and sends a queue sentinel on shutdown. Wait for that worker to exit before the lifespan closes, including if adapter startup fails. Keep message handling and the single outbound path unchanged.

**Tech stack:** Python 3.11, FastAPI lifespan, `threading`, `unittest`, coverage.py 7.10.7, macOS GitHub Actions.

## Evidence and scope

- [x] Inspect first failed and second successful attempts of regression run 38464234975. All 75 mesh tests passed in attempt 1; `coverage run` then exited 139. Attempt 2 passed on the same commit.
- [x] Reproduce the lifecycle leak locally: after the 75 tests, three `mesh-responder` daemon threads remained alive. The link to the rare segfault is plausible but not yet proved.
- [x] Add regression tests in `install/macos/mesh-service/tests/test_app_endpoints.py` for normal shutdown and startup failure. Both failed against the prior code.
- [x] Update `install/macos/mesh-service/mesh_service/app.py` to stop and join the worker on shutdown, with cleanup if startup raises. The join runs off the event loop.
- [x] Run the focused test and all 77 mesh tests with coverage; run 50 process-exit repetitions. Confirm no worker threads remain after the suite. Translation, oMLX, and shell regressions also passed locally.
- [ ] Review the diff, commit with a co-author trailer, open a PR, inspect GitHub checks and repeat CI if needed. Merge only after the gate passes; close issue #70 only if the evidence supports stability.

## Review

The 77 mesh tests pass with 94% statement coverage and no warnings. A separate
post-suite probe found only `MainThread` alive; before the fix, three responder
threads survived. Fifty local coverage runs exited zero both before and after
the change, so local stress runs alone cannot establish the cause of the rare
GitHub runner segfault. The failed attempt and its successful same-commit rerun
remain recorded in issue #70. GitHub CI review is pending.
