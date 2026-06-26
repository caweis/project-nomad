import type { HttpContext } from '@adonisjs/core/http'
import KVStore from '#models/kv_store'
import { GrocyClient } from '#services/grocy_client'
import { GrocyProvisioner } from '#services/grocy_provisioner'

/**
 * Settings + connection for the Grocy food-readiness integration. NOMAD installs
 * Grocy and owns its data volume, so it provisions its own read access on enable
 * (see GrocyProvisioner) — the page is a single toggle, no URL or key to paste.
 * The API key lives in KV server-side only and is never serialized to the
 * browser; the page receives just `enabled` and `provisioned` booleans.
 */
export default class GrocyController {
  async settings({ inertia }: HttpContext) {
    const [enabled, apiKey] = await Promise.all([
      KVStore.getValue('grocy.enabled'),
      KVStore.getValue('grocy.apiKey'),
    ])
    return inertia.render('settings/grocy', {
      grocy: {
        enabled: enabled === true,
        provisioned: !!apiKey,
      },
    })
  }

  /**
   * Test the configured connection: returns food-calorie coverage so the
   * operator can confirm the URL/key (and see how much of their pantry has
   * calorie data) before relying on it for days-of-supply.
   */
  async testConnection({ response }: HttpContext) {
    const client = new GrocyClient()
    if (!(await client.isConfigured())) {
      return response.ok({
        ok: false,
        error: 'Turn on Grocy food readiness first.',
      })
    }
    try {
      const energy = await client.totalFoodEnergy()
      return response.ok({
        ok: true,
        covered: energy.covered,
        total: energy.total,
        totalKcal: Math.round(energy.totalKcal),
      })
    } catch (error) {
      return response.ok({
        ok: false,
        error: error instanceof Error ? error.message : 'Grocy is unreachable.',
      })
    }
  }

  /**
   * Turn food readiness on or off. On enable, NOMAD provisions its own Grocy
   * read access (mints an API key in Grocy's database, records the internal
   * URL), so there is nothing for the operator to paste. Returns a clear error
   * if Grocy is not initialized yet instead of failing silently.
   */
  async setEnabled({ request, response }: HttpContext) {
    const enabled = request.input('enabled') === true || request.input('enabled') === 'true'
    if (!enabled) {
      await GrocyProvisioner.disable()
      return response.ok({ ok: true, enabled: false })
    }
    try {
      await GrocyProvisioner.enable()
      return response.ok({ ok: true, enabled: true })
    } catch (error) {
      return response.ok({
        ok: false,
        enabled: false,
        error: error instanceof Error ? error.message : 'Could not set up the Grocy connection.',
      })
    }
  }
}
