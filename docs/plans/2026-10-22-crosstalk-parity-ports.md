# Crosstalk parity ports implementation plan

> For Codex: implement each slice with a failing regression and verify it before delivery.

**Goal:** Port the confirmed Crosstalk features from `54ee30a4` into the macOS fork while retaining its native Ollama, oMLX, and virtualized library behavior.

**Architecture:** Adapt upstream behavior at the fork's existing controller and service call sites. Keep settings in the existing KV store, use pure helpers for sampling and retrieval decisions, and preserve native and compatibility transports. The shared controllers put the integrated implementation in one commit with retained tests.

**Tech stack:** AdonisJS 6, TypeScript, React, BullMQ, Qdrant, MapLibre, Node 24.

---

## Baseline and decisions

- [x] Confirm the fork and Crosstalk branch heads, clean working tree, current call paths, and parity ledger.
- [x] Create a single-writer working branch from `origin/main`.
- [x] Chris first chose automatic retries with stable Qdrant entry IDs, then chose to disable automatic retries. Keep stable IDs for an explicit restart.
- [x] Add retained focused regressions for the ports; confirm the Kiwix parser failure before its fix.

## Ports in dependency order

- [x] Retrieval relevance floor: adapt `rag.minRelevance` to the fork's search and chat injection path; test post-rerank filtering and no-context/citation behavior.
- [x] Optional off-topic judge: add `rag.relevanceCheck`, structured verdict parsing, fail-open handling, and focused tests after the floor.
- [x] Response style: add `ai.responseStyle` and sampler helpers, wire native Ollama and oMLX compatibility requests, settings UI, and direct tests.
- [x] Score v2 local calculation: port Linux raw measurements and the frozen formula, retain Mac's native v1 path, and test reference-score equality. Chris chose to keep v2 results local.
- [x] World basemap: adapt upstream provisioning to the Mac service and MapLibre page, retain existing regional maps, and test idempotence and missing-map messaging.
- [x] Expandable Kiwix rows: keep virtualization, add measured expansion and keyboard support, and test row data and interaction behavior.
- [x] Embedding stall recovery: use stable point and per-run continuation IDs, and prove a stalled batch cannot fork a second continuation chain.

## Verification and delivery

- [x] Run focused tests, admin typecheck and production build, full Adonis and standalone suites, and applicable Python and shell suites.
- [x] Check final test counts and coverage, finish arm64 image build, and review the complete diff for Mac and security regressions.
- [x] Fetch `origin/main` before committing, push the branch, and open a review PR with exact gates and installed-Mac limitations.
- [x] Update the parity ledger and this plan's review section with review work and verified deferrals.

## Review

The implementation is in [draft PR #74](https://github.com/caweis/project-nomad/pull/74).
The final all-suite coverage run passed 368 Japa cases, 4 runner
checks, and 84 standalone suites. Admin statement coverage is 27.63%, up from
the 26.38% baseline recorded in the prior coverage plan. Vite no longer emits
shutdown scan errors during the unit suite. Translation passed 19 cases (69%
source coverage), mesh passed 77 (94%), oMLX passed 75 (30%), and all ten
macOS shell scripts passed. A temporary Qdrant v1.16 instance confirmed that
the new cleanup filter removes pre-upgrade random-ID points and keeps stable-ID
points. The Node 24 arm64 image built and ran its SQLite and ZIM native
packages. Its pinned pmtiles CLI extracted a real z0-5 Protomaps world map
into a temporary directory. The Linux Score v2 path now checks disk space
before pulling an uncached 8B model; its regression failed before the fix
and passed afterward.

The installed Mac acceptance pass remains in #56. Repository-wide lint has
existing failures in #66; added `.ts` files passed focused lint. The new
TSX component passed formatting and the production build.

The v2 leaderboard endpoint would send additional hardware and workload
metadata. Automatic approval review rejected that new submission path without
specific authorization, and Chris chose to keep Score v2 local. The branch
blocks v2 results from the legacy v1 endpoint. Chris chose an experimental Mac
v2 result alongside the existing native legacy benchmark.

## Follow-up: final picker choices

- [x] Disable BullMQ automatic embedding retries, mark the first failed attempt
  as failed, and keep stable Qdrant point IDs for an explicit fresh start.
- [x] Add an experimental Mac Score v2 path with the arm64 sysbench workload in the
  Linux VM and the fixed 8B model through native Ollama. Preserve the Mac
  native legacy benchmark; label v2 as experimental and local-only.
- [x] Add retained regressions for the changed queue policy, Mac v2 path, and
  legacy result when experimental v2 cannot run.
- [x] Repeat typecheck, build, focused and full regression/coverage gates.
- [x] Update the parity ledger, PR description and decision record; do not run
  the installed Mac's bare `nomad upgrade` while this work is a draft PR.

The follow-up gate passed 371 Adonis tests, 4 runner checks, and 84 standalone
suites. The focused rerun passed 12 cases. Admin statement coverage was 27.89%.
The installed Mac's native Ollama endpoint responded from the benchmark worker,
but the 8B Mac benchmark has not run end to end; #56 tracks that acceptance.
Repository-wide lint still fails on existing findings tracked in #66.
Draft PR #74 and issue #76 now record Chris's final choices. The branch has
the follow-up code, while the installed Mac remains on `main`.
