import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { RAG_MIN_FINAL_SCORE } from '../../constants/ollama.js'
import { parseMinRelevance } from './rag_relevance.js'

const CACHE_TTL_MS = 60_000
let cache: { value: number; expiresAt: number } | null = null

export function invalidateMinRelevanceCache(): void {
  cache = null
}

export async function resolveMinFinalScore(): Promise<number> {
  const now = Date.now()
  if (cache && now < cache.expiresAt) return cache.value
  try {
    const value = parseMinRelevance(await KVStore.getValue('rag.minRelevance'), RAG_MIN_FINAL_SCORE)
    cache = { value, expiresAt: now + CACHE_TTL_MS }
    return value
  } catch {
    logger.warn('[RAG] Could not read relevance setting; using the default floor')
    return RAG_MIN_FINAL_SCORE
  }
}
