# November 24 upstream maintenance implementation plan

Goal: Port newly applicable Crosstalk changes through main f633b36e and dev fcca88cd, preserve macOS/Apple Silicon, and update review PR #88 after regression and coverage gates.

Architecture: Extend the existing isolated PR worktree at d4dd4450. Keep Mac native inference, passwordless admin, terminal stalled embeddings and local experimental Score v2. Adapt new collection aliases within existing guarded download/reconcile paths. No installed-stack mutation or merge.

## Tasks
- [x] Read global AGENTS, memory, parity ledger and weekly tracking issue #4. Fetch actual branch heads and inspect PR #88.
- [x] Confirm unchanged fork main5266e8a4 and Apple upstream5a3f3d16. PR88 remains open with no comments/reviews; its previous Python/shell checks failed before acquiring hosted Mac runners.
- [x] Audit and port map CORS normalization and error response restriction (2ef44ce4): add failing path traversal/error HTTP regressions in admin/tests/unit/maps_cors.spec.ts, then minimal middleware change. Preserve valid GET/HEAD/range/preflight behavior.
- [x] Adapt resource aliases (13048a89/ecaa8c93/f633b36e): validate previous_ids, map installed rows and files without losing user content; constrain cleanup to approved resource aliases; prove old installs/updates/deletion and reject near-match books. Isolated worker owns collection code/tests.
- [x] Triage Wikipedia repair migration, catalog updates, URL failure tracking, translation image, Node pin and Discord links against fork implementations. Add applicable repairs with regression tests; document unchanged/N/A items.
- [x] Independently inspect contributed diff and red/green test evidence; integrate scoped patches without overwriting other work.
- [x] Run server and frontend typechecks, production build, full admin coverage + real queue worker, Python coverage, shell regressions and collection checks. Record existing red gates honestly.
- [x] Review TypeScript changes, security paths and final staged diff. Fetch origin before scoped commits. Update parity ledger and verification report; run humanizer/fact checks for public prose.
Publication and hosted regression results are recorded on [PR #88](https://github.com/caweis/project-nomad/pull/88). This plan records local implementation and verification; the PR remains the review boundary.

## Review

Prepared the applicable November 24 ports and retained the prior November 17 work on PR #88. Preserved macOS/Apple Silicon inference, the translation engine and the selected embedding/benchmark policies. No release or installed-stack upgrade was performed.

The final combined gate passed server TypeScript, production build, 529 Japa cases, four runner checks, 90 standalone suites and four real-worker checks. Admin line coverage is 32.30%. All 171 Python tests passed. The installer and catalog scripts passed; one reset-ollama assertion was skipped because the real drive is mounted. All 117 live catalog URLs passed.

Full lint failed with 3,005 errors and five warnings, none on new/added lines (#66). Frontend typecheck retained 12 unchanged diagnostics (#87). The fresh audit reports 38 affected packages on the unchanged lockfile (#63). These remain open, along with installed-device acceptance (#56) and country extraction (#86).

The final source review resolved the stale-file, startup and checkpoint findings. Redis checkpoint persistence now runs outside SQL locks, with predecessor and catalog-policy revalidation before publication. The reviewer repeated eight independent regression cases against the integrated source; all passed. The [verification report](2026-11-24-upstream-maintenance-verification.md) records coverage and test limits.
