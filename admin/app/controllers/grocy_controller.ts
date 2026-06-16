import type { HttpContext } from '@adonisjs/core/http'
import KVStore from '#models/kv_store'
import { GrocyClient } from '#services/grocy_client'

/**
 * Settings + connection test for the Grocy food-readiness integration. The API
 * key is read server-side only and is NEVER serialized to the browser — the
 * settings page receives just `hasApiKey` (a boolean), so the secret can't leak
 * into the Inertia payload. Writes go through the existing PATCH
 * /api/system/settings KV endpoint; this controller only reads + tests.
 */
export default class GrocyController {
  async settings({ inertia }: HttpContext) {
    const [enabled, baseUrl, apiKey] = await Promise.all([
      KVStore.getValue('grocy.enabled'),
      KVStore.getValue('grocy.baseUrl'),
      KVStore.getValue('grocy.apiKey'),
    ])
    return inertia.render('settings/grocy', {
      grocy: {
        enabled: enabled === true,
        baseUrl: baseUrl ?? '',
        hasApiKey: !!apiKey,
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
        error: 'Enable Grocy and set both a base URL and an API key first.',
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
}
