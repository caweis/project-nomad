import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import KVStore from '#models/kv_store'

/**
 * Auto-provisions NOMAD's read access to a NOMAD-installed Grocy, so food
 * readiness works from a single toggle with no URL or API key to paste.
 *
 * NOMAD installs Grocy and mounts its data volume, so it mints its own read key
 * directly: one INSERT into Grocy's `api_keys` table, the same columns Grocy's
 * own ApiKeyService.CreateApiKey writes (api_key, user_id, expires, key_type,
 * description). The key carries a description tag so enable() is idempotent —
 * we reuse our row instead of piling up a new key on every toggle.
 *
 * This can't be exercised off the appliance (it needs a running, initialized
 * Grocy), so every step fails loudly with an operator-actionable message. A
 * failed INSERT is atomic — it never half-writes or corrupts Grocy's database.
 */
export class GrocyProvisioner {
  // The admin container mounts the storage volume at /app/storage (same as the
  // STL scanner). Grocy's /config bind is <storage>/grocy; the LinuxServer image
  // keeps the SQLite DB under data/. Documented path first, then a fallback.
  private static readonly DB_CANDIDATES = [
    '/app/storage/grocy/data/grocy.db',
    '/app/storage/grocy/grocy.db',
  ]

  // The admin reaches Grocy over the internal Docker network by container name
  // and container port (80) — not the published host port.
  static readonly INTERNAL_URL = 'http://nomad_grocy:80'

  // Tags the key as ours so we reuse it instead of re-minting on every enable.
  private static readonly KEY_DESCRIPTION = 'NOMAD food readiness (auto-provisioned)'

  static resolveDbPath(): string | null {
    return GrocyProvisioner.DB_CANDIDATES.find((p) => existsSync(p)) ?? null
  }

  /**
   * Return NOMAD's Grocy API key, minting one on first use. Throws if Grocy's
   * database isn't present yet (the app isn't installed, or has never been
   * opened to initialize its schema).
   */
  static ensureApiKey(): string {
    const dbPath = GrocyProvisioner.resolveDbPath()
    if (!dbPath) {
      throw new Error(
        'Grocy is not set up yet. Install Grocy and open it once so it creates its database, then turn this on.'
      )
    }

    const db = new Database(dbPath, { timeout: 5000 })
    try {
      db.pragma('busy_timeout = 5000')

      const existing = db
        .prepare('SELECT api_key FROM api_keys WHERE description = ? ORDER BY id DESC LIMIT 1')
        .get(GrocyProvisioner.KEY_DESCRIPTION) as { api_key: string } | undefined
      if (existing?.api_key) return existing.api_key

      // 50 hex chars, matching the length of Grocy's own RandomString(50) keys.
      const apiKey = randomBytes(25).toString('hex')
      db.prepare(
        `INSERT INTO api_keys (api_key, user_id, expires, key_type, description)
         VALUES (?, 1, '2999-12-31 23:59:59', 'default', ?)`
      ).run(apiKey, GrocyProvisioner.KEY_DESCRIPTION)
      return apiKey
    } finally {
      db.close()
    }
  }

  /** Turn the integration on: mint or reuse the key, record the URL, flip enabled. */
  static async enable(): Promise<void> {
    const apiKey = GrocyProvisioner.ensureApiKey()
    await KVStore.setValue('grocy.apiKey', apiKey)
    await KVStore.setValue('grocy.baseUrl', GrocyProvisioner.INTERNAL_URL)
    await KVStore.setValue('grocy.enabled', true)
  }

  static async disable(): Promise<void> {
    await KVStore.setValue('grocy.enabled', false)
  }
}
