import vine from "@vinejs/vine";
import { SETTINGS_KEYS } from "../../constants/kv_store.js";

// Validate the `key` query param on GET /api/settings — without this, the
// endpoint reads whatever string the caller supplies into KVStore.getValue
// and reflects it back, allowing arbitrary key probing. Ports upstream
// b183bc6 (CWE-20 input validation).
export const getSettingSchema = vine.compile(vine.object({
    key: vine.enum(SETTINGS_KEYS),
}))

export const updateSettingSchema = vine.compile(vine.object({
    key: vine.enum(SETTINGS_KEYS),
    value: vine.any().optional(),
}))

// Validate the body of POST /api/home/pins (issue #44). `key` is an item's
// deckKey (a service_name or a hardcoded feature key: ai-assistant / maps /
// workshop / drug-reference / preparedness), NOT a KV key — so it is a bounded
// string, not the SETTINGS_KEYS enum. Length-capped to keep one corrupt caller
// from bloating the home.pins JSON blob.
export const setPinSchema = vine.compile(vine.object({
    key: vine.string().trim().minLength(1).maxLength(128),
    pinned: vine.boolean(),
}))