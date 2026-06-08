---
type: design-spec
date: 2026-06-07
status: approved
feature: Drug Reference → offline medical-library cross-reference
target_version: 0.2.7xx patch (own session, after the 0.2.710 migration batch)
decided_by: Chris (2026-06-07 brainstorm)
related:
  - docs/superpowers/audits/2026-06-07-canonical-cascade-audit.md
  - collections/kiwix-categories.json
tags: [drug-reference, zim, kiwix, cross-reference, offline]
---

# Drug Reference → Offline Medical-Library Cross-Reference

## Goal

On a drug's detail page, surface links into the user's **downloaded** offline
medical library (ZIM content served by Kiwix): a deep-link to the drug's own
article, plus a few related-topic links derived from the drug's indications.
The section is always present and explains itself when there is nothing to show.

## Why this is cheap (what already exists)

- **kiwix-serve is already running.** A `ghcr.io/kiwix/kiwix-serve:3.8.1`
  container serves every downloaded `.zim` on host port **8090**
  (`admin/database/seeders/service_seeder.ts`), and it restarts when new ZIMs
  download (`ZimService.downloadRemoteSuccessCallback`). Serving and full-text
  search over ZIMs are its job; this feature only *calls* it.
- **Installed ZIMs are tracked.** `installed_resource` rows
  (`admin/app/models/installed_resource.ts`) carry `resource_id`
  (e.g. `wikipedia_en_medicine_maxi`) and `collection_ref`
  (e.g. `medicine-comprehensive`). `collections/kiwix-categories.json` lists
  which ids are medical. So "is a medical library installed?" is a cheap query.
- **The drug match key exists.** `drug_labels.generic_name` (and `brand_name`,
  `indications`) are already populated; medical-encyclopedia articles are titled
  by generic name (e.g. "Metformin").

## Architecture decision: NO new container

This is a thin admin-app feature over the existing kiwix-serve container, not a
new service. The work is a DB query + a couple of HTTP calls to kiwix-serve +
string-building + a React card — I/O-bound, no heavy process, no separate
runtime, no independent scaling need. It lives in the admin app alongside Drug
Reference, Workshop, and Preparedness. A separate container would add an image,
a compose service, networking, and health checks for zero benefit.

### Internal-URL vs browser-URL (the one nuance that bites)

- **Server-side queries** (suggest / search) use the internal Docker network
  URL from `DockerService.getServiceURL(SERVICE_NAMES.KIWIX)` →
  `http://nomad_kiwix_server:8090` in prod (`http://localhost:8090` in dev).
- **Rendered deep-links** (`<a href>`) must use a **host/LAN-reachable** base
  the user's browser can resolve — the internal hostname will not resolve in the
  browser. Derive the link base from the request host (the same host serving the
  admin) on port 8090, or a configured public base. The endpoint returns
  browser-ready hrefs; the server never hands the internal hostname to the UI.

## Decisions (from the 2026-06-07 brainstorm)

1. **Search backend:** Kiwix's own suggest/full-text search, NOT RAG. RAG would
   require the ZIMs to be embedded (a separate heavy step) and returns chunks,
   not clean article links. Kiwix native search is fast, local, and needs no
   embedding.
2. **Link depth:** exact article (with fallback) AND cross-linked conditions.
3. **Condition extraction (v1):** Kiwix full-text search over the indications
   text — Kiwix's ranking does the matching; no NLP, no LLM.
4. **Always-on section:** the card always renders; empty states explain
   themselves (Chris 2026-06-07: "the section should appear always, and if
   nothing found, say nothing found").

## Components

### 1. Service: `DrugReferenceOfflineService` (new)

`admin/app/services/drug_reference_offline_service.ts`

- `installedMedicalBooks(): Promise<KiwixBook[]>` — query `installed_resource`
  for `resource_type='zim'` whose id is medical per `kiwix-categories.json`
  (plus general encyclopedias that contain medical articles). Returns the Kiwix
  book name(s) to scope queries to.
- `offlineLinksFor(drug): Promise<OfflineLinksResult>` — orchestrates:
  - if no medical book → `{ status: 'no_zim' }`
  - else call kiwix suggest(generic_name) scoped to the book(s); build the drug
    article deep-link; if no confident match, build a scoped Kiwix search URL
    instead.
  - call kiwix full-text search(indications-derived query) scoped to the
    book(s); take top 3–5 hits as related topics (deduped, drug article
    excluded).
  - kiwix-serve unreachable / non-200 → `{ status: 'unavailable' }`.
  - matches → `{ status: 'matches', drugArticle, relatedTopics }`;
    no hits at all → `{ status: 'no_match' }`.
- Short in-memory cache (per drug id, ~60s TTL) so rapid navigation doesn't
  hammer kiwix-serve.

### 2. Pure helpers (unit-tested standalone)

`admin/util/kiwix_links.ts`

- `isMedicalBook(resourceId, categories): boolean`
- `buildViewerUrl(hostBase, book, articlePath): string` — the deep-link.
- `buildSearchUrl(hostBase, book, term): string` — the fallback / scoped search.
- `pickBestSuggestion(suggestions, genericName): Suggestion | null` — choose the
  confident exact match (case-insensitive title equality / normalized).
- `indicationsToQuery(indications): string` — trim the free text to a focused
  query (first sentence / N chars), strip boilerplate ("for the temporary
  relief of …").

### 3. Endpoint

`GET /api/drug-reference/:id/offline-links` on `DrugReferenceController` →
returns `OfflineLinksResult`. Integer-id guard; never throws to the UI.

### 4. UI

`admin/inertia/pages/drug-reference/show.tsx` — an "In your offline library"
card near the bottom, lazy-fetching the endpoint after mount (mirrors the
existing lazy pdf-text pattern in Workshop). Renders by status:

- `matches` → drug article link (primary) + "Related topics" list.
- `no_match` → "No matching articles found in your offline library."
- `no_zim` → "No offline medical library installed." as a **link to the ZIM
  library / download page**, so it doubles as a prompt to add WikiMed.
- `unavailable` → "Couldn't reach your offline library."

All article links open the Kiwix viewer in a new tab. The card keeps Drug
Reference's existing framing (offline reference, not medical advice, not an FDA
endorsement, not a cross-drug checker).

## Data flow

Page mount → `GET /api/drug-reference/:id/offline-links` → service resolves
installed medical book(s) → kiwix-serve suggest + search (internal URL) → build
browser-ready hrefs (host URL) → status + links to the card. Nothing stored,
nothing precomputed; always reflects currently-installed ZIMs.

## Failure handling

Best-effort throughout. kiwix-serve down, timeout, or non-200 → `unavailable`
state; the drug page itself is never blocked or errored. Empty results map to
`no_match`. Missing medical ZIM maps to `no_zim`. No exceptions reach the UI.

## Build-time verification (operator-side, on the mini)

Confirm kiwix-serve 3.8.1's exact endpoint shapes against the live container
before wiring (the scheme below is the documented standard but must be verified):
- suggest: `GET /suggest?content=<book>&term=<q>`
- full-text search: `GET /search?books.name=<book>&pattern=<q>&pageLength=N`
- viewer deep-link: `/viewer#<book>/<path>` (and the article path returned by
  suggest/search).

## Out of scope (v1) — possible v2

- LLM-based condition extraction (would use the existing oMLX/Ollama, still no
  new container).
- Curated condition→article maps.
- RAG / embeddings path.
- Precomputed drug↔article mappings (DB table).
- Reverse links (from a ZIM article back to relevant drugs).

## Testing

- Pure helpers in `kiwix_links.ts` unit-tested standalone via
  `node --experimental-strip-types` (Japa can't boot locally without DB/Redis):
  `isMedicalBook`, `buildViewerUrl`, `buildSearchUrl`, `pickBestSuggestion`,
  `indicationsToQuery`.
- Service tested with kiwix-serve HTTP mocked across the four statuses.
- Gates: backend `npm run typecheck` = 0; inertia tsc = baseline; no new node
  deps; **no migration** (this feature adds none).
- Manual mini verify (operator): with WikiMed installed, open a drug (e.g.
  Metformin) → drug article link + related topics appear and open in the viewer;
  uninstall/none → the card shows the "no offline medical library" prompt.
