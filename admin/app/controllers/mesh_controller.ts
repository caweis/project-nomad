import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { MeshService } from '#services/mesh_service'
import { SystemService } from '#services/system_service'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { validateAlertBody, type MeshStatus } from '../../util/mesh.js'

/**
 * Mesh Bridge admin console HTTP boundary.
 *
 * Mirrors ChatsController: `inertia()` gates on whether the Mesh service is
 * installed (404 when it isn't, same as the AI-assistant gate) and renders the
 * page with the initial status; the read actions (status, messages) proxy
 * MeshService; `send()` validates the outbound body against the radio budget
 * (validateAlertBody) and rejects empty/over-budget with a 422 BEFORE keying a
 * transmission, otherwise calls MeshService.sendAlert.
 *
 * Route posture (start/routes.ts): the page + the read GETs are ungated (the
 * fork's GET posture); POST /mesh/send carries localNetworkOnly() because it
 * triggers a radio transmission — the same posture as the mutating #32
 * custom-app routes.
 */
@inject()
export default class MeshController {
  constructor(private meshService: MeshService, private systemService: SystemService) {}

  /**
   * GET /mesh — the console page. Gates on the Mesh service being installed
   * (404 otherwise, mirroring ChatsController.inertia). Loads the initial status
   * so the panel renders without a client round-trip; a bridge that's installed
   * but unreachable degrades to a safe "disconnected" status (parseMeshStatus)
   * rather than blanking the page.
   */
  async inertia({ inertia, response }: HttpContext) {
    const meshInstalled = await this.systemService.checkServiceInstalled(SERVICE_NAMES.MESH)
    if (!meshInstalled) {
      return response.status(404).json({ error: 'Mesh Bridge service not installed' })
    }

    let initialStatus: MeshStatus | null = null
    try {
      initialStatus = await this.meshService.getStatus()
    } catch (error) {
      // An installed-but-unreachable bridge must still render the page; the
      // status panel shows "disconnected" and the client can re-poll.
      logger.warn(
        { err: error },
        '[MeshController] Initial status fetch failed; rendering with null status'
      )
    }

    return inertia.render('mesh/index', {
      initialStatus,
    })
  }

  /** GET status — proxy the bridge's /status (typed, defensive). */
  async status({ response }: HttpContext) {
    try {
      const status = await this.meshService.getStatus()
      return response.status(200).json(status)
    } catch (error) {
      logger.error({ err: error }, '[MeshController] Failed to read mesh status')
      return response.status(502).json({ error: 'Mesh Bridge is unreachable' })
    }
  }

  /** GET messages — proxy the bridge's /messages (typed, defensive). */
  async messages({ response }: HttpContext) {
    try {
      const messages = await this.meshService.getMessages()
      return response.status(200).json({ messages })
    } catch (error) {
      logger.error({ err: error }, '[MeshController] Failed to read mesh messages')
      return response.status(502).json({ error: 'Mesh Bridge is unreachable' })
    }
  }

  /**
   * POST send — transmit an outbound alert over the radio. Validates the body
   * against the radio budget first; an empty or over-budget body is a 422 (the
   * validator's message is surfaced) and never reaches the bridge. The route is
   * localNetworkOnly()-gated in routes.ts because this keys a transmission.
   */
  async send({ request, response }: HttpContext) {
    const to = typeof request.input('to') === 'string' ? request.input('to') : ''
    const rawBody = request.input('body')

    const validation = validateAlertBody(rawBody)
    if (!validation.ok) {
      return response.status(422).json({ error: validation.message, reason: validation.reason })
    }

    try {
      await this.meshService.sendAlert(to, validation.body)
      return response.status(200).json({ success: true })
    } catch (error) {
      logger.error({ err: error }, '[MeshController] Failed to send mesh alert')
      return response.status(502).json({ error: 'Mesh Bridge is unreachable' })
    }
  }
}
