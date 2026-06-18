import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DockerService } from './docker_service.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import {
  parseMeshStatus,
  parseMeshMessages,
  validateAlertBody,
  type MeshStatus,
  type MeshMessage,
} from '../../util/mesh.js'

/**
 * Admin client for the Mesh Bridge container (nomad_mesh, host 8600).
 *
 * The bridge (shipped in Wave A) exposes GET /status, GET /messages, and POST
 * /send. This service is the admin-side client for those three endpoints: it
 * resolves the container URL through the injected DockerService (the same way
 * RagService resolves Qdrant), bounds every call with a timeout so a wedged
 * radio never hangs the console, and maps the raw JSON through the pure guards
 * in util/mesh.ts before handing it up.
 *
 * The validation/mapping logic is pure and lives in util/mesh.ts (validateAlertBody,
 * parseMeshStatus, parseMeshMessages) so the same rules drive the controller's
 * 422 decision, the page's byte counter, and the standalone tests. Only the live
 * HTTP lives here — and it's mini-gated (no Docker / no :8600 in this harness).
 */
@inject()
export class MeshService {
  /** Bound every bridge call so an unreachable/wedged radio can't hang the console. */
  private static REQUEST_TIMEOUT_MS = 5000

  constructor(private dockerService: DockerService) {}

  /**
   * Resolve the bridge's base URL via DockerService, throwing a clear error when
   * the Mesh service isn't installed/running. Mirrors RagService's
   * `getServiceURL(SERVICE_NAMES.QDRANT)` resolution — MESH is already a seeded
   * Service (host 8600) so getServiceURL resolves it.
   */
  private async baseUrl(): Promise<string> {
    const url = await this.dockerService.getServiceURL(SERVICE_NAMES.MESH)
    if (!url) {
      throw new Error('Mesh Bridge service is not installed or running.')
    }
    return url
  }

  /**
   * GET a JSON resource from the bridge, bounded by REQUEST_TIMEOUT_MS and
   * surfacing a non-2xx as an error (the grocy_client posture). Returns the
   * parsed JSON untyped; callers map it through the util/mesh.ts guards.
   */
  private async getJson(path: string): Promise<unknown> {
    const base = await this.baseUrl()
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(MeshService.REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Mesh ${path} returned HTTP ${response.status}`)
    }
    return await response.json()
  }

  /**
   * The bridge's /status, mapped to the typed MeshStatus. parseMeshStatus is
   * defensive, so a malformed payload degrades to a safe "disconnected" status
   * rather than throwing.
   */
  async getStatus(): Promise<MeshStatus> {
    const json = await this.getJson('/status')
    return parseMeshStatus(json)
  }

  /**
   * The bridge's /messages, mapped to a typed MeshMessage[] (most recent as the
   * bridge orders them). A malformed payload maps to an empty list.
   */
  async getMessages(): Promise<MeshMessage[]> {
    const json = await this.getJson('/messages')
    return parseMeshMessages(json)
  }

  /**
   * POST an outbound alert to the bridge (/send), which keys a radio
   * transmission. Validates the body against the radio budget first
   * (validateAlertBody) and throws on an empty/over-budget body BEFORE any
   * network call — a defense-in-depth check even though the controller already
   * gates with the same validator. The accepted (trimmed) body is what gets
   * transmitted.
   */
  async sendAlert(to: string, body: string): Promise<void> {
    const validation = validateAlertBody(body)
    if (!validation.ok) {
      throw new Error(validation.message)
    }

    const base = await this.baseUrl()
    const response = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to, body: validation.body }),
      signal: AbortSignal.timeout(MeshService.REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Mesh /send returned HTTP ${response.status}`)
    }
    logger.info(`[Mesh] Outbound alert sent to "${to || 'broadcast'}" (${validation.body.length} chars)`)
  }
}
