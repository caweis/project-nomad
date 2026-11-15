# Promote Supply Depot cards

**Goal:** Make the Supply Depot card page the destination for app-catalog links. Redirect old bookmarks.

**Architecture:** Keep `/supply-depot` and its existing shared service props. Change `/settings/apps` to a redirect, repoint internal links, and remove the table component after its callers are gone. Keep the table page's pin control, auto-update control for curated apps, credential notes, and version parsing on the card before retiring the table. No database change.

---

## Design and evidence

On the installed Mac, `/supply-depot` rendered category cards and the Apple MLX state; AI Assistant showed the Apple MLX label and no Update action. The custom-app dialog and an installed app's action menu opened. The sidebar still linked to `/settings/apps`. The controller already builds one set of props for both pages, and the table page has no importers. Before this change, the card lacked pin/unpin, curated-app auto-update, and bundled-app sign-in notes. Its Update dialog also used a second image-tag parser.

Keep the current NOMAD typography, palette, category grouping, and card interactions. This is a route promotion rather than a visual redesign. The existing card grid and sidebar stay in place. Check the narrow layout during verification. The redirect keeps saved links working.

## Task 1: Retained regression

**Files:** Create `admin/tests/standalone/supply_depot_navigation.standalone.ts`.

1. Assert the legacy route redirects to `/supply-depot` and every navigation entry point uses `/supply-depot`.
2. Guard the card page's pin handler, curated auto-update control, credential notes, and shared image-tag parser. Assert the retired table page is absent and the card page remains present.
3. Run `node --experimental-strip-types tests/standalone/supply_depot_navigation.standalone.ts` from `admin/`; observe the expected failure before edits.

## Task 2: Route and navigation

**Files:** Modify `admin/start/routes.ts`, `admin/app/controllers/settings_controller.ts`, `admin/inertia/layouts/HomeLayout.tsx`, `admin/inertia/layouts/SettingsLayout.tsx`, `admin/inertia/pages/home.tsx`, `admin/inertia/pages/easy-setup/index.tsx`, and `admin/inertia/pages/settings/benchmark.tsx`. Modify `admin/inertia/pages/settings/supply-depot.tsx` and `admin/inertia/components/SupplyDepotCard.tsx`; delete `admin/inertia/pages/settings/apps.tsx`. Update stale comments in shared Supply Depot helpers where they refer to two active pages.

1. Redirect `GET /settings/apps` to `/supply-depot`.
2. Remove the unused table controller method and component.
3. Carry the table page's pin and auto-update actions, sign-in notes, and shared image-tag parser onto the card page.
4. Point every internal app-catalog link at `/supply-depot`.
5. Run the new regression, typecheck, and production build.

## Task 3: Gate and delivery

1. Run the full admin regression and coverage command. Record real test counts and coverage.
2. Review `git diff --check`, all changed references, and the rendered host baseline.
3. Fetch origin main, commit the exact scoped files with a Co-Authored-By trailer, push a review branch, and open a draft PR. Keep it draft while GitHub Actions remains disabled.

## Review

- The retained navigation regression failed on the old links, then passed after the route and page changes. The shared image-tag and home-deck suites also passed.
- Typecheck and production build passed. The complete test and coverage gate passed under Node 24: 30 Adonis spec files discovered, 80 standalone suites passed, and 26.68% statement coverage measured across the configured admin source tree.
- A local preview server returned HTTP 302 with `Location: /supply-depot` for `/settings/apps`. It used dummy database settings; rendering the card from this branch against installed data remains an installed-host acceptance check.
- Repository-wide lint failed with 3,322 errors and 5 warnings. The new regression file passes ESLint; existing formatting and lazy-import violations remain on touched legacy files.
- GitHub Actions is disabled for this repository, tracked in issue #75, so CI verification remains pending.
