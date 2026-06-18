/**
 * Mesh Bridge — pure helpers shared by the service, controller, page, and the
 * standalone gate tests.
 *
 * The math/validation lives here (pure, unit-tested) so the same rules drive the
 * server (MeshService.sendAlert / MeshController.send), the client byte counter
 * (inertia/pages/mesh/index.tsx), and the two standalone tests — mirroring the
 * util/readiness.ts convention (one source of truth, no duplicated logic across
 * the boundary). The live HTTP against the mesh container (nomad_mesh:8600)
 * stays in MeshService; nothing here touches the network.
 */

/**
 * Hard cap on an outbound alert body, in characters.
 *
 * The mesh radio is tiny — LoRa frames carry only a couple hundred bytes after
 * protocol overhead, so a long message can't physically transmit. 200 chars is
 * a sane, conservative ceiling that leaves headroom for addressing/framing on
 * every adapter (Meshtastic / MeshCore). The byte counter on the send form and
 * the server-side validateAlertBody both gate on this single constant.
 */
export const ALERT_BODY_MAX_CHARS = 200

/** Why a candidate alert body was rejected — surfaced to the caller verbatim. */
export type AlertBodyRejection = 'empty' | 'too_long'

/** The result of validating an outbound alert body before transmission. */
export type AlertBodyValidation =
  | { ok: true; body: string }
  | { ok: false; reason: AlertBodyRejection; message: string }

/**
 * Validate an outbound alert body before it is handed to the radio.
 *
 * Rejects an empty / whitespace-only body (nothing to transmit) and a body over
 * the radio budget (ALERT_BODY_MAX_CHARS). The accepted body is trimmed of
 * surrounding whitespace — leading/trailing spaces waste scarce frame bytes.
 * The length check runs against the trimmed body so trailing whitespace can't
 * tip an otherwise-fine message over the cap.
 *
 * Pure and side-effect-free: the controller calls this to decide a 422, and the
 * send form mirrors the same rule for its live counter.
 */
export function validateAlertBody(body: unknown): AlertBodyValidation {
  const raw = typeof body === 'string' ? body : ''
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', message: 'Alert body cannot be empty.' }
  }

  if (trimmed.length > ALERT_BODY_MAX_CHARS) {
    return {
      ok: false,
      reason: 'too_long',
      message: `Alert body is ${trimmed.length} characters — the radio budget is ${ALERT_BODY_MAX_CHARS}.`,
    }
  }

  return { ok: true, body: trimmed }
}

/** A single mesh message, in or out, as the console renders it. */
export interface MeshMessage {
  /** Stable id when the bridge supplies one; else a render-time fallback. */
  id?: string
  /** 'in' = received over the air, 'out' = sent from this node. */
  direction: 'in' | 'out'
  /** Peer address/name (sender for inbound, recipient for outbound). */
  peer?: string
  /** The message text. */
  body: string
  /** Epoch millis when the bridge logged it, when known. */
  timestamp?: number
}

/** The mesh adapter's connection + identity status, as the console renders it. */
export interface MeshStatus {
  /** Which radio backend the bridge is bound to (e.g. 'meshtastic', 'meshcore'). */
  adapter: string
  /** The node/device model the adapter reports, when known. */
  model: string | null
  /** Whether the bridge currently has a live link to the radio. */
  connected: boolean
  /** This node's address/name on the mesh, when known. */
  nodeId: string | null
}

/**
 * Map a raw /status payload from the mesh bridge into the typed MeshStatus the
 * console renders. Fully defensive: a non-object, a null, or any missing/
 * wrong-typed field degrades to a safe default (adapter 'unknown', model null,
 * disconnected, nodeId null) rather than throwing — an unreachable or
 * mid-upgrade bridge must render as "disconnected", never crash the page.
 *
 * Accepts both snake_case and camelCase for the id field (`node_id` / `nodeId`)
 * since the bridge's wire shape isn't frozen yet.
 */
export function parseMeshStatus(json: unknown): MeshStatus {
  const FALLBACK: MeshStatus = {
    adapter: 'unknown',
    model: null,
    connected: false,
    nodeId: null,
  }

  if (!json || typeof json !== 'object') {
    return FALLBACK
  }

  const obj = json as Record<string, unknown>

  const adapter =
    typeof obj.adapter === 'string' && obj.adapter.trim() !== '' ? obj.adapter.trim() : 'unknown'

  const model = typeof obj.model === 'string' && obj.model.trim() !== '' ? obj.model.trim() : null

  const connected = obj.connected === true

  const nodeIdRaw =
    typeof obj.nodeId === 'string'
      ? obj.nodeId
      : typeof obj.node_id === 'string'
        ? obj.node_id
        : null
  const nodeId = nodeIdRaw && nodeIdRaw.trim() !== '' ? nodeIdRaw.trim() : null

  return { adapter, model, connected, nodeId }
}

/**
 * Map a single raw message entry from the bridge into a typed MeshMessage.
 * Defensive on every field; an unparseable direction falls back to 'in', a
 * missing body to ''. Returns null only for a non-object entry so the caller can
 * filter it out.
 */
function parseMeshMessage(entry: unknown): MeshMessage | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const obj = entry as Record<string, unknown>

  const direction = obj.direction === 'out' ? 'out' : 'in'
  const body = typeof obj.body === 'string' ? obj.body : ''
  const id = typeof obj.id === 'string' && obj.id.trim() !== '' ? obj.id : undefined
  const peer = typeof obj.peer === 'string' && obj.peer.trim() !== '' ? obj.peer.trim() : undefined
  const timestamp =
    typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp) ? obj.timestamp : undefined

  return { id, direction, peer, body, timestamp }
}

/**
 * Map a raw /messages payload into a typed MeshMessage[]. Accepts either a bare
 * array or a `{ messages: [...] }` envelope (the bridge's shape isn't frozen),
 * and drops any entry that isn't an object. Never throws — a malformed payload
 * renders as an empty list.
 */
export function parseMeshMessages(json: unknown): MeshMessage[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).messages)
      ? ((json as Record<string, unknown>).messages as unknown[])
      : []

  const out: MeshMessage[] = []
  for (const entry of list) {
    const parsed = parseMeshMessage(entry)
    if (parsed) out.push(parsed)
  }
  return out
}
