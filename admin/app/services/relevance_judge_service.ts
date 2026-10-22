import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { ChatService } from '#services/chat_service'
import { OllamaService } from '#services/ollama_service'
import { RELEVANCE_CHECK_MAX_TOKENS, SYSTEM_PROMPTS } from '../../constants/ollama.js'
import {
  buildJudgeInput,
  isRelevanceCheckEnabled,
  ON_TOPIC_SCHEMA,
  pickOnTopic,
} from '../utils/relevance_judge.js'
import { resolveStructured } from '../utils/structured_output.js'

export type JudgedChunk = { text: string; metadata?: Record<string, any> }
export type JudgeResult<T> = { kept: T[]; rejected: number; judged: boolean }

/** Optional second filter for coherent but unrelated search results. */
@inject()
export class RelevanceJudgeService {
  constructor(
    private ollamaService: OllamaService,
    private chatService: ChatService
  ) {}

  async resolveModel(chatModel: string): Promise<string | null> {
    try {
      if (!isRelevanceCheckEnabled(await KVStore.getValue('rag.relevanceCheck'))) return null
      return (await this.chatService.resolveTasksModel(chatModel)) ?? chatModel
    } catch {
      logger.warn('[RAG] Could not resolve relevance model; using retrieved passages')
      return null
    }
  }

  async judge<T extends JudgedChunk>(
    question: string,
    chunks: T[],
    model: string
  ): Promise<JudgeResult<T>> {
    const keepAll = (): JudgeResult<T> => ({ kept: chunks, rejected: 0, judged: false })
    if (chunks.length === 0 || !question.trim()) return keepAll()

    try {
      const result = await this.ollamaService.chat({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.relevance_check },
          {
            role: 'user',
            content: buildJudgeInput(
              question,
              chunks.map((chunk) => ({
                text: chunk.text,
                title:
                  chunk.metadata?.full_title ||
                  chunk.metadata?.article_title ||
                  chunk.metadata?.archive_title,
              }))
            ),
          },
        ],
        options: { num_predict: RELEVANCE_CHECK_MAX_TOKENS, temperature: 0 },
        think: false,
        format: ON_TOPIC_SCHEMA,
      })
      const verdict = resolveStructured(
        result.message.content.trim(),
        pickOnTopic,
        result.structured === true
      )
      if (!verdict.ok) {
        logger.warn('[RAG] Relevance check returned no usable verdict; keeping retrieved passages')
        return keepAll()
      }
      return verdict.value
        ? { kept: chunks, rejected: 0, judged: true }
        : { kept: [], rejected: chunks.length, judged: true }
    } catch {
      logger.warn('[RAG] Relevance check failed; keeping retrieved passages')
      return keepAll()
    }
  }
}
