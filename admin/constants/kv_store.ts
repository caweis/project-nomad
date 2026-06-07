import { KVStoreKey } from "../types/kv_store.js";

export const SETTINGS_KEYS: KVStoreKey[] = [
  'chat.suggestionsEnabled',
  'chat.lastModel',
  'ui.hasVisitedEasySetup',
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
  'readiness.petWaterPerDay',
  'readiness.petFoodPerDay',
  'readiness.powerPerDay',
];