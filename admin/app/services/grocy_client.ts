import KVStore from '#models/kv_store'
import {
  computeFoodEnergy,
  type FoodEnergy,
  type GrocyProduct,
  type GrocyStockRow,
} from '../../util/grocy_food_energy.js'

/** Bound a Grocy request so a slow/unreachable container never hangs the readiness dashboard. */
const REQUEST_TIMEOUT_MS = 3000

interface GrocyConfig {
  enabled: boolean
  baseUrl: string | null
  apiKey: string | null
}

/**
 * Read-only client for the Grocy food container's REST API, used by the
 * federated-readiness integration to pull food stock + per-product calories so
 * Supply Readiness can fold "food on hand" into days-of-supply.
 *
 * Server-side ONLY: the API key is read from KV and never serialized to the
 * browser. Auth is the `GROCY-API-KEY` header (a key the user mints in Grocy's
 * UI — Grocy has no endpoint to mint one). `calories` is kcal per stock unit and
 * the units cancel against the stock `amount`, so no quantity-unit conversion is
 * needed here (see util/grocy_food_energy.ts).
 */
export class GrocyClient {
  private async config(): Promise<GrocyConfig> {
    const [enabled, baseUrl, apiKey] = await Promise.all([
      KVStore.getValue('grocy.enabled'),
      KVStore.getValue('grocy.baseUrl'),
      KVStore.getValue('grocy.apiKey'),
    ])
    return {
      enabled: enabled === true,
      baseUrl: baseUrl ? baseUrl.trim().replace(/\/+$/, '') : null,
      apiKey: apiKey ? apiKey.trim() : null,
    }
  }

  /** True when the integration is enabled and has both a base URL and an API key. */
  async isConfigured(): Promise<boolean> {
    const c = await this.config()
    return c.enabled && !!c.baseUrl && !!c.apiKey
  }

  private async request<T>(path: string): Promise<T> {
    const { baseUrl, apiKey } = await this.config()
    if (!baseUrl || !apiKey) {
      throw new Error('Grocy is not configured')
    }
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'GROCY-API-KEY': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Grocy ${path} returned HTTP ${response.status}`)
    }
    return (await response.json()) as T
  }

  /** Product master: id + per-stock-unit calories (Grocy stores numbers as strings). */
  async fetchProducts(): Promise<GrocyProduct[]> {
    const raw =
      await this.request<Array<{ id: number | string; calories: number | string | null }>>(
        '/api/objects/products'
      )
    return raw.map((p) => ({ id: Number(p.id), calories: toNullableNumber(p.calories) }))
  }

  /** Current stock overview: product_id + on-hand amount (non-aggregated). */
  async fetchStock(): Promise<GrocyStockRow[]> {
    const raw =
      await this.request<Array<{ product_id: number | string; amount: number | string }>>(
        '/api/stock'
      )
    return raw.map((s) => ({ product_id: Number(s.product_id), amount: Number(s.amount) || 0 }))
  }

  /**
   * Total food energy on hand (kcal) + coverage. Throws if Grocy is unreachable
   * or misconfigured — the caller (ReadinessService) catches and falls back to
   * in-app inventory so water/power readiness still render.
   */
  async totalFoodEnergy(): Promise<FoodEnergy> {
    const [products, stock] = await Promise.all([this.fetchProducts(), this.fetchStock()])
    return computeFoodEnergy(products, stock)
  }
}

/** Grocy returns numbers as strings; an empty/absent calorie value means "no data" (null). */
function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
