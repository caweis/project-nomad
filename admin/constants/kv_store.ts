import { KVStoreKey } from "../types/kv_store.js";

export const SETTINGS_KEYS: KVStoreKey[] = [
  'chat.suggestionsEnabled',
  'chat.lastModel',
  'ui.hasVisitedEasySetup',
  'ui.theme',
  'ui.homeLayout',
  'rag.defaultIngestPolicy',
  'system.earlyAccess',
  'ai.assistantCustomName',
  'inventory.measurementSystem',
  // Self-Reliance Suite — Phase 2 Readiness Calculator household config. Each
  // is settable through the existing PATCH /api/system/settings endpoint (the
  // validator enums `key` against this list), the same path the Inventory units
  // toggle uses. See KV_STORE_SCHEMA for the shapes + cited defaults.
  'readiness.householdAdults',
  'readiness.householdChildren',
  'readiness.needs',
  'readiness.targetHorizonDays',
  'readiness.pets',
  'readiness.petWaterPerDay',
  'readiness.petFoodPerDay',
  'readiness.powerPerDay',
  // Opt-in automatic updates — the user-settable master switches + window/cool-off/
  // cap. Settable through PATCH /api/system/settings; the value validator (Task 7)
  // enforces HH:MM windows, 0-8760h cool-off, and a >=0 byte cap. The service-written
  // state keys (lastResult / consecutiveFailures / window accounting) are NOT here.
  'autoUpdate.enabled',
  'autoUpdate.windowStart',
  'autoUpdate.windowEnd',
  'autoUpdate.cooloffHours',
  'appAutoUpdate.enabled',
  'contentAutoUpdate.enabled',
  'contentAutoUpdate.windowStart',
  'contentAutoUpdate.windowEnd',
  'contentAutoUpdate.cooloffHours',
  'contentAutoUpdate.maxBytesPerWindow',
];