
export const KV_STORE_SCHEMA = {
  'chat.suggestionsEnabled':    'boolean',
  'chat.lastModel':             'string',
  'rag.docsEmbedded':           'boolean',
  'system.updateAvailable':     'boolean',
  'system.latestVersion':       'string',
  'system.earlyAccess':         'boolean',
  'ui.hasVisitedEasySetup':     'boolean',
  'ai.assistantCustomName':     'string',
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
  // Total daily water intake for ALL pets combined, in base units (L/day),
  // user-entered. No authoritative per-pet figure exists (AVMA gives durations
  // only), so the user supplies their pets' normal intake. Default '0'.
  'readiness.petWaterPerDay': 'string',
  // Total daily food intake for ALL pets combined, in base units (kcal/day),
  // user-entered. Default '0'.
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
} as const

type KVTagToType<T extends string> = T extends 'boolean' ? boolean : string

export type KVStoreKey = keyof typeof KV_STORE_SCHEMA
export type KVStoreValue<K extends KVStoreKey> = KVTagToType<(typeof KV_STORE_SCHEMA)[K]>
