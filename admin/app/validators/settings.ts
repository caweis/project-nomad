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