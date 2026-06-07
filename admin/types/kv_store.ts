
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
} as const

type KVTagToType<T extends string> = T extends 'boolean' ? boolean : string

export type KVStoreKey = keyof typeof KV_STORE_SCHEMA
export type KVStoreValue<K extends KVStoreKey> = KVTagToType<(typeof KV_STORE_SCHEMA)[K]>
