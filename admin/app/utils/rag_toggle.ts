/**
 * The `rag.enabled` off-switch: should chat-time knowledge base retrieval run?
 *
 * Default-ON is the whole subtlety. The key does not exist on any install that
 * predates the toggle, and every neighbouring boolean setting coerces off the
 * POSITIVE (`v === true || v === 'true'` — see the ai.autoThinking read in the
 * chat header) because those default OFF. Copying that shape here would read an
 * absent key as false and silently switch retrieval off for every existing
 * user: no error, no failing test, just an assistant that quietly stops using
 * the knowledge base. So this coerces off the NEGATIVE — only an explicit off
 * value disables retrieval; unset, unknown or malformed means on.
 *
 * Both shapes really do arrive here. Server-side the value comes from
 * KVStore.getValue (a parsed boolean, or null when unset), but the KV column is
 * TEXT and booleans have historically round-tripped as strings; client-side the
 * chat header's optimistic update writes a real boolean into the query cache
 * before the server has answered, and the query is `undefined` while loading.
 *
 * Ported from upstream #1247, which reads the same KV key server-side.
 */
export function isRagRetrievalEnabled(value: unknown): boolean {
  if (value === false || value === 0) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return !(normalized === 'false' || normalized === '0')
  }
  return true
}
