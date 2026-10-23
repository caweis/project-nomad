# Port Kiwix mirror browsing

Issue #37 tracks Crosstalk's custom library sources. The source commit is 62e75fdb in Crosstalk main. The fork already has the Kiwix catalog, ZIM download pipeline, and a virtualized Content Explorer. Keep those paths.

## Contract

- Store the five upstream built-in mirrors and user-added sources in one table. Built-in rows cannot be removed.
- Let a user select a source, browse directories, and download a ZIM through the existing job pipeline. Keep the current catalog language filter and virtualized default list.
- Browse requests identify a saved source and a relative directory. Reject paths that escape the source root or change host. Block redirects and check resolved addresses against loopback, link-local, and metadata targets while allowing private LAN mirrors.
- Keep directory responses bounded and parse links as data. Show a clear error when a mirror does not expose a directory listing.

## Work

- [x] Trace current ZIM routes, download validation, installed-file state, and upstream mirror behavior.
- [x] Add regression tests for URL checks, listing parsing, source protection, and mirror download completion. The first URL and Wikipedia tests failed before the fixes.
- [x] Add migration, model, source service, controller routes, and API client methods.
- [x] Add source selection, management dialog, folder browser, and download confirmation to Content Explorer.
- [x] Run typecheck, production build, full regression and coverage gate, and changed-file lint review.
- [x] Verify the migration, API, and browser with a disposable MySQL container and local directory listing.
- [ ] Commit and open a draft PR. Keep it draft until GitHub Actions runs and installed-Mac acceptance is complete.

## Review

The production build and full test run passed: 342 Adonis tests and 79 standalone suites. Statement coverage is 26.54%. The new backend and test files pass ESLint; the repository still has older lint errors.

In the isolated preview, migration seeded five built-in mirrors. HTTP checks covered listing, source creation and removal, a rejected loopback URL, a rejected path escape, and protected built-in rows. The browser opened a local mirror folder, showed its ZIM file and download confirmation, and returned to the default catalog after the test source was removed. No ZIM download was started.

GitHub reports Actions as enabled, but PR #74 has no workflow run; issue #75 tracks that gap. The installed Mac has not been upgraded to this branch. Keep the PR in draft review.
