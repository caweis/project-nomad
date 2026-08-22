
export const KV_STORE_SCHEMA = {
  'chat.suggestionsEnabled':    'boolean',
  'chat.lastModel':             'string',
  'rag.docsEmbedded':           'boolean',
  // KB auto-index policy ('Always' | 'Manual', RFC #883). Unset = 'Always' so
  // existing installs keep their behavior until the user opts into Manual.
  'rag.defaultIngestPolicy':    'string',
  // Master switch for chat-time knowledge base retrieval (upstream #1247).
  // Unset/null means ON — the behaviour from before the toggle existed. Off
  // skips the whole retrieval pipeline in OllamaController.chat: the
  // hasDocuments check, the query-rewrite LLM call and the Qdrant search. That
  // matters on a small Mac and when the knowledge base is small or empty. Read
  // it through isRagRetrievalEnabled (app/utils/rag_toggle.ts), never a bare
  // truthiness check — the default is ON, so an absent value must not read as
  // false.
  'rag.enabled':                'boolean',
  'system.updateAvailable':     'boolean',
  'system.latestVersion':       'string',
  'system.earlyAccess':         'boolean',
  'ui.hasVisitedEasySetup':     'boolean',
  // Night Ops theme preference ('light' | 'dark'); synced cross-device from the
  // ThemeToggle via api.updateSetting. The FOUC script reads localStorage, not this.
  'ui.theme':                   'string',
  // Home dashboard layout preference: 'grid' (traditional flat tile grid, the
  // default) or 'decks' (categorized scenario decks). Null → 'grid'.
  'ui.homeLayout':              'string',
  'ai.assistantCustomName':     'string',
  // Global default for model "thinking"/reasoning. Off by default; a per-request
  // preference (resolved client-side) overrides it. Ported from upstream #1079.
  'ai.autoThinking':            'boolean',
  // Model used for short ancillary AI work — chat titles, suggestion chips, and
  // RAG query rewriting — instead of whichever model the user is chatting with.
  // Unset/null keeps the previous behaviour: titles and query rewrites reuse the
  // chat model, suggestions use chooseSuggestionModel's capped pick. Ported from
  // upstream #1244, with the fork's background-task size cap still enforced —
  // pickTasksModel refuses a pick that is uninstalled or over
  // SUGGESTION_MODEL_MAX_BYTES and falls back rather than cold-loading a second
  // large model (see app/utils/chat_suggestion_model.ts).
  'ai.tasksModel':              'string',
  'ai.contextWindow':           'string',
  // Workshop / Offline STL Library — user has acknowledged the rights modal
  // on first visit ("Use at your own peril. You are responsible for ensuring
  // you have the right to store every STL you put in this library."). Until
  // accepted, the key simply doesn't exist; once accepted, value is 'true'.
  'workshop.rightsAcknowledged': 'boolean',
  // Self-Reliance Suite — Inventory measurement-system preference. 'us' (US
  // customary) or 'metric'. Drives display-unit conversion in the Inventory UI
  // and the Phase 2 calculator's display defaults. Default 'us' when unset.
  // Switching is lossless: every resource_contribution is stored in its base
  // unit, so a toggle re-displays existing rows instantly with no migration.
  'inventory.measurementSystem': 'string',
  // Self-Reliance Suite — Phase 2 Readiness Calculator household config. KV
  // stores strings, so integers/floats are string-encoded and `readiness.needs`
  // is a JSON string; ReadinessService parses each defensively with a fallback
  // to the documented default (the kv_store consume pattern). These persist via
  // the existing /api/system/settings PATCH endpoint — no new mutation route.
  // The cited model (spec §5.1.1) has NO multipliers: adults + children both
  // count as full persons; pets and power are user-entered totals.
  //
  // Adults in the household (full persons for water + food). Default '2'.
  'readiness.householdAdults': 'string',
  // Children in the household. NOT discounted — full persons for water (FEMA /
  // Ready.gov: children "will require even more"), 2000 kcal default for food.
  // Default '0'.
  'readiness.householdChildren': 'string',
  // Per-person-per-day needs in BASE units (water L, food kcal, power Wh) as a
  // JSON string. Default '{"water":3.785411784,"food":2000,"power":0}' — 1 US
  // gal water (Ready.gov/FEMA), 2000 kcal (FDA Nutrition Facts), power 0 =
  // "not tracked until you set it" (no authoritative per-person Wh exists).
  'readiness.needs': 'string',
  // Supply horizon in days. Default '14' (shelter-at-home; American Red Cross +
  // FEMA FA-321 two-week supply). 3-day floor applies to evacuation.
  'readiness.targetHorizonDays': 'string',
  // The household's pets as typed entries — a JSON array of { type, count }
  // (for type 'other' also per-pet waterL + kcal). KV is schemaless, so this is
  // a JSON string parsed defensively (parsePets) with a [] fallback. The
  // calculator multiplies each entry by app/data/pet_needs.ts (typical-adult
  // per-pet/day water L + food kcal) to derive the total pet water/food load
  // fed into the readiness compute. Replaces the manual petWaterPerDay /
  // petFoodPerDay totals (kept below as a read-only legacy fallback so existing
  // installs don't lose their pet figures). Default '[]'.
  'readiness.pets': 'string',
  // LEGACY (read-only fallback): total daily water intake for ALL pets combined,
  // in base units (L/day), from the pre-typed-pets manual field. Still READ as a
  // fallback when readiness.pets is absent so existing installs keep their pet
  // water, but no longer WRITTEN — typed pets in readiness.pets supersede it.
  'readiness.petWaterPerDay': 'string',
  // LEGACY (read-only fallback): total daily food intake for ALL pets combined,
  // in base units (kcal/day). See readiness.petWaterPerDay.
  'readiness.petFoodPerDay': 'string',
  // Total daily power need in base units (Wh/day), user-entered. There is no
  // universal per-person watt-hour standard; fabricating one is a safety
  // hazard, so power readiness is dormant (0) until the user sets a load.
  // Default '0'.
  'readiness.powerPerDay': 'string',
  // Drug Reference v1 — export_date of the last successfully completed
  // openFDA drug-label ingest (e.g. "2026-06-06"). Written by
  // IngestDrugDataJob on final-part completion; read by the search page's
  // status panel to show "Last updated: <date>". Null when never ingested.
  'drugReference.lastUpdatedExportDate': 'string',
  // Drug Reference — two-step ingest download-state marker (no migration; status
  // lives in job data + this KV key). Written by DownloadDrugDataJob after the
  // LAST part lands on disk; a JSON string of DownloadStateMarker
  // ({ export_date, totalParts, parts: [{ index, name, path, bytes }],
  // completedAtMs }). Read by IngestDrugDataJob to rebuild the part list for a
  // manual "Ingest into search" run (no manifest, no re-download) and by the
  // service to gate POST /ingest. Parsed defensively (parseDownloadState) with a
  // null fallback — the key simply doesn't exist before the first download.
  // Cleared after a full ingest succeeds (when the on-disk parts are deleted).
  'drugReference.downloadState': 'string',
  // Grocy federated readiness — connection to the Grocy food container, read by
  // GrocyClient server-side ONLY (never serialized to the browser). `grocy.enabled`
  // gates the integration; `grocy.baseUrl` is the Grocy REST base (the operator
  // sets and tests it — Grocy's container host port differs from its internal
  // port, so the URL is configured, not guessed); `grocy.apiKey` is a key the user
  // mints in Grocy's UI (Grocy has no API to mint one). When any is unset the
  // integration is off and food readiness falls back to in-app inventory rows.
  // See docs/superpowers/plans/2026-06-15-grocy-federated-readiness.md.
  'grocy.enabled': 'boolean',
  'grocy.baseUrl': 'string',
  'grocy.apiKey': 'string',
  // Command Center home — per-app pin overrides (issue #44). A JSON object keyed
  // by each item's deckKey (a service's service_name, or a hardcoded feature key:
  // ai-assistant / maps / workshop / drug-reference / preparedness) -> explicit
  // pinned boolean. An entry overrides the default `display_order <= 8` rule;
  // absent keys fall back to it. KV values are always strings, so this is stored
  // as a JSON string and the home controller JSON.stringifies on write /
  // JSON.parses on read with a `{}` fallback — the same JSON-in-KV pattern as
  // `readiness.needs`. The tag is 'string' so getValue/setValue serialize it
  // through a string at the storage boundary; the richer static value type
  // (Record<string, boolean>) is pinned via KV_STORE_TYPED_VALUES below. Default
  // {} (an empty/absent value leaves the home identical to today).
  'home.pins': 'string',
  // Opt-in automatic updates (Phase 0 shared scaffolding; OFF by default). KV is
  // schemaless/string-typed, so HH:MM windows, integer hours, and byte caps are
  // string-encoded and parsed defensively by each tier's service. The user-settable
  // keys (master switches + window/cooloff/cap) are also listed in SETTINGS_KEYS;
  // the *.lastResult / lastError / consecutiveFailures / autoDisabledReason /
  // window-accounting keys are service-written state, not user-settable.
  //
  // Core admin self-update (apply via host bridge `nomad upgrade` on macOS).
  'autoUpdate.enabled':              'boolean',
  'autoUpdate.windowStart':          'string',
  'autoUpdate.windowEnd':            'string',
  'autoUpdate.cooloffHours':         'string',
  'autoUpdate.lastAttemptAt':        'string',
  'autoUpdate.lastError':            'string',
  'autoUpdate.lastResult':           'string',
  'autoUpdate.consecutiveFailures':  'string',
  'autoUpdate.autoDisabledReason':   'string',
  // Core cool-off anchor: the latest version seen and when it was first seen.
  'autoUpdate.firstSeenVersion':     'string',
  'autoUpdate.firstSeenAt':          'string',
  // Installed-app (sibling container) updates. Reuses the core autoUpdate.window*.
  'appAutoUpdate.enabled':           'boolean',
  'appAutoUpdate.lastAttemptAt':     'string',
  'appAutoUpdate.lastResult':        'string',
  // Content (ZIM/map) updates. Own window + a per-window byte cap.
  'contentAutoUpdate.enabled':             'boolean',
  'contentAutoUpdate.windowStart':         'string',
  'contentAutoUpdate.windowEnd':           'string',
  'contentAutoUpdate.cooloffHours':        'string',
  'contentAutoUpdate.maxBytesPerWindow':   'string',
  'contentAutoUpdate.lastAttemptAt':       'string',
  'contentAutoUpdate.lastResult':          'string',
  'contentAutoUpdate.lastError':           'string',
  'contentAutoUpdate.consecutiveFailures': 'string',
  'contentAutoUpdate.autoDisabledReason':  'string',
  'contentAutoUpdate.windowBytesUsed':     'string',
  'contentAutoUpdate.windowResetAt':       'string',
} as const

/**
 * Keys whose logical value type is richer than their storage tag. The schema
 * tag (above) is 'string' so the model serializes through a string at the
 * storage boundary; the entry here pins the static getValue/setValue type to
 * the real shape. `home.pins` is the deckKey -> pinned override map (issue #44).
 */
export const KV_STORE_TYPED_VALUES = {
  'home.pins': {} as Record<string, boolean>,
} as const

// The schema tag drives runtime (de)serialization: 'boolean' -> parseBoolean,
// anything else -> raw string. Keys listed in KV_STORE_TYPED_VALUES carry a
// richer static value type while still serializing through a string at the
// storage boundary.
type KVTagToType<T extends string> = T extends 'boolean' ? boolean : string

export type KVStoreKey = keyof typeof KV_STORE_SCHEMA
export type KVStoreValue<K extends KVStoreKey> = K extends keyof typeof KV_STORE_TYPED_VALUES
  ? (typeof KV_STORE_TYPED_VALUES)[K]
  : KVTagToType<(typeof KV_STORE_SCHEMA)[K]>
