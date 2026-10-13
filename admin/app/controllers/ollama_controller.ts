import { ChatService } from '#services/chat_service'
import { ContextWindowService } from '#services/context_window_service'
import { NomadMdService } from '#services/nomad_md_service'
import { OllamaService } from '#services/ollama_service'
import { RagService } from '#services/rag_service'
import { modelNameSchema } from '#validators/download'
import { chatSchema, getAvailableModelsSchema } from '#validators/ollama'
import KVStore from '#models/kv_store'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { RAG_CONTEXT_LIMITS, SYSTEM_PROMPTS } from '../../constants/ollama.js'
import { buildContextBlock } from '../utils/rag_context.js'
import { buildCitations } from '../utils/citations.js'
import type { ChatSource } from '../../types/chat.js'
import { getContextLimitsForModel, trimToContextBudget } from '../utils/rag_prompt.js'
import { planPrompt, splitForBudget, type BudgetMessage } from '../utils/context_budget.js'
import { isRagRetrievalEnabled } from '../utils/rag_toggle.js'
import logger from '@adonisjs/core/services/logger'
import type { Message } from 'ollama'
import { rm } from 'node:fs/promises'
import { CHAT_IMAGE_LIMITS, CHAT_IMAGE_UPLOAD_OPTIONS } from '../../constants/chat_images.js'
import {
  attachImagesToLatestUserMessage,
  ChatImageError,
  normalizeChatImages,
  type NormalizedChatImage,
} from '../utils/chat_images.js'
import { readMultipartChatPayload } from '../utils/chat_multipart.js'
import { clientHasLeft } from '../utils/client_gone.js'
import { failureReason, unknownVisionFailureMessage } from '../utils/model_capabilities.js'
import type { ModelVisionCapability } from '../../types/ollama.js'

@inject()
export default class OllamaController {
  constructor(
    private chatService: ChatService,
    private ollamaService: OllamaService,
    private ragService: RagService,
    private nomadMdService: NomadMdService,
    private contextWindowService: ContextWindowService
  ) { }

  async availableModels({ request }: HttpContext) {
    const reqData = await request.validateUsing(getAvailableModelsSchema)
    return await this.ollamaService.getAvailableModels({
      sort: reqData.sort,
      recommendedOnly: reqData.recommendedOnly,
      query: reqData.query || null,
      limit: reqData.limit || 15,
      force: reqData.force,
    })
  }

  async chat({ request, response }: HttpContext) {
    // A chat that carries images is multipart, because JSON cannot carry files:
    // the usual request body travels as JSON text in a `payload` field beside
    // them (see chat_multipart.ts). Images are read from disk once, below, and
    // the uploads are deleted straight away so they do not sit in tmp for the
    // length of a long answer.
    const uploadedImages = request.files('images', CHAT_IMAGE_UPLOAD_OPTIONS)
    const cleanupUploadedImages = () =>
      Promise.all(
        uploadedImages
          .filter((file) => file.tmpPath)
          .map((file) => rm(file.tmpPath!, { force: true }).catch(() => undefined))
      )

    let reqData: Awaited<ReturnType<typeof chatSchema.validate>>
    try {
      if (uploadedImages.length > 0) {
        const envelope = readMultipartChatPayload(request.input('payload'))
        if (!envelope.ok) {
          await cleanupUploadedImages()
          return response.status(422).send({ message: envelope.message })
        }
        reqData = await chatSchema.validate(envelope.payload)
      } else {
        reqData = await request.validateUsing(chatSchema)
      }
    } catch (error) {
      await cleanupUploadedImages()
      throw error
    }

    let normalizedImages: NormalizedChatImage[] = []
    try {
      normalizedImages = await normalizeChatImages(uploadedImages, CHAT_IMAGE_LIMITS)
    } catch (error) {
      if (error instanceof ChatImageError) {
        return response.status(error.status).send({ message: error.message })
      }
      throw error
    } finally {
      await cleanupUploadedImages()
    }

    // Refuse before anything is streamed, so the page gets a status and a reason
    // instead of an event stream that opens and immediately fails.
    let vision: ModelVisionCapability = 'unknown'
    if (normalizedImages.length > 0) {
      if (!reqData.messages.some((message) => message.role === 'user')) {
        return response.status(422).send({ message: 'Images require a user message.' })
      }
      vision = await this.ollamaService.getModelVision(reqData.model)
      if (vision === 'unsupported') {
        return response.status(422).send({
          message: `The selected model "${reqData.model}" does not support image input.`,
        })
      }
    }
    // A model that never said whether it can see, handed an image it cannot use,
    // fails in whatever way its backend fails. This marks that case, so the
    // failure can be explained instead of reported as a generic error.
    let imageRequestRejected = false

    // Someone who left while their pictures were being processed, or while the
    // model's abilities were looked up, has left all the same, and the listener
    // below would never hear about it (client_gone.ts). Look before starting.
    if (clientHasLeft(response.response)) {
      logger.debug('[OllamaController] Client left before generation started')
      return
    }

    // Flush SSE headers immediately so the client connection is open while
    // pre-processing (query rewriting, RAG lookup) runs in the background.
    //
    // The reader is tracked from here, not from the start of generation.
    // Someone who leaves during the query rewrite or the knowledge-base search
    // has left all the same, and a 'close' listener attached after the socket
    // closed would never hear about it.
    const readerGone = new AbortController()
    if (reqData.stream) {
      response.response.setHeader('Content-Type', 'text/event-stream')
      response.response.setHeader('Cache-Control', 'no-cache')
      response.response.setHeader('Connection', 'keep-alive')
      response.response.flushHeaders()
      response.response.on('close', () => readerGone.abort())
    }

    try {
      // If there are no system messages in the chat inject system prompts
      const hasSystemMessage = reqData.messages.some((msg) => msg.role === 'system')
      if (!hasSystemMessage) {
        const systemPrompt = {
          role: 'system' as const,
          content: SYSTEM_PROMPTS.default,
        }
        logger.debug('[OllamaController] Injecting system prompt')
        reqData.messages.unshift(systemPrompt)
      }

      // Inject the user-managed NOMAD.md as its own leading system message so the
      // user's persistent instructions take precedence, while the default
      // formatting prompt and any RAG context below remain intact. A missing or
      // blank file yields null and changes nothing.
      const nomadPrompt = await this.nomadMdService.getSystemPrompt()
      if (nomadPrompt) {
        logger.debug('[OllamaController] Injecting NOMAD.md system prompt')
        reqData.messages.unshift({ role: 'system' as const, content: nomadPrompt })
      }

      // Knowledge base retrieval is user-toggleable — the chat header switch and
      // the AI Assistant settings switch write the same rag.enabled KV key, so
      // they are one control in two places. Unset means ON, so installs that
      // predate the toggle keep retrieving (isRagRetrievalEnabled coerces off
      // the negative for exactly that reason).
      //
      // Turning it off has to actually cost nothing, and null is already this
      // pipeline's skip-everything channel: rewriteQueryWithContext returns null
      // when the knowledge base is empty, and the `if (rewrittenQuery)` below is
      // what gates the Qdrant search. Not calling it at all also skips the
      // hasDocuments check and the query-rewrite LLM call, so all three of the
      // expensive steps are skipped rather than just the injection.
      // Ported from upstream #1247.
      const ragEnabled = isRagRetrievalEnabled(await KVStore.getValue('rag.enabled'))
      if (!ragEnabled) {
        logger.debug('[RAG] Retrieval disabled by setting, skipping')
      }

      // Query rewriting for better RAG retrieval with manageable context
      // Will return user's latest message if no rewriting is needed
      const rewrittenQuery = ragEnabled
        ? await this.rewriteQueryWithContext(reqData.messages, reqData.model)
        : null

      logger.debug(`[OllamaController] Rewritten query for RAG: "${rewrittenQuery}"`)
      // Provenance for the answer about to be generated (upstream #1179),
      // surfaced under it as "Sources". Stays empty whenever retrieval was off
      // or found nothing, which is the honest result: no context, no citations.
      let sources: ChatSource[] = []
      if (rewrittenQuery) {
        const relevantDocs = await this.ragService.searchSimilarDocuments(
          rewrittenQuery,
          5, // Top 5 most relevant chunks
          0.3, // Minimum similarity score of 0.3
          reqData.collection || undefined // Scope RAG search to a KB collection (#1063)
        )

        logger.debug(`[RAG] Retrieved ${relevantDocs.length} relevant documents for query: "${rewrittenQuery}"`)

        // If relevant context is found, inject as a system message with adaptive limits
        if (relevantDocs.length > 0) {
          // Budgeting and rendering both moved to pure helpers so they can be
          // tested without MySQL/Qdrant/Ollama — see rag_prompt.standalone.ts.
          // Behaviour is unchanged, quirks included.
          const limits = getContextLimitsForModel(reqData.model, RAG_CONTEXT_LIMITS)
          const trimmedDocs = trimToContextBudget(relevantDocs, limits)

          logger.debug(
            `[RAG] Injecting ${trimmedDocs.length}/${relevantDocs.length} results (model: ${reqData.model}, maxResults: ${limits.maxResults}, maxTokens: ${limits.maxTokens || 'unlimited'})`
          )

          const contextText = buildContextBlock(trimmedDocs)
          // From trimmedDocs, not relevantDocs: a chunk trimmed out above never
          // reached the model, and citing it would credit the answer to a
          // document it was not based on. The block goes in as a leading system
          // message, which planPrompt never drops, so this is what the model
          // reads.
          sources = buildCitations(trimmedDocs)

          const systemMessage = {
            role: 'system' as const,
            content: SYSTEM_PROMPTS.rag_context(contextText),
          }

          // Insert system message at the beginning (after any existing system messages)
          const firstNonSystemIndex = reqData.messages.findIndex((msg) => msg.role !== 'system')
          const insertIndex = firstNonSystemIndex === -1 ? 0 : firstNonSystemIndex
          reqData.messages.splice(insertIndex, 0, systemMessage)
        }
      }

      // Thinking is enabled only when the model supports it AND the user wants it: the explicit
      // per-request preference wins, otherwise the global default (ai.autoThinking, default OFF).
      // gpt-oss models take a 'medium' text param instead of true (https://docs.ollama.com/api/chat).
      // Ported from upstream #1079 — previously thinking was auto-on whenever the model was capable.
      const thinkingCapability = await this.ollamaService.checkModelHasThinking(reqData.model)
      let thinkingEnabled = false
      if (thinkingCapability) {
        thinkingEnabled = reqData.think ?? ((await KVStore.getValue('ai.autoThinking')) ?? false)
      }
      const think: boolean | 'medium' =
        thinkingEnabled ? (reqData.model.startsWith('gpt-oss') ? 'medium' : true) : false

      // Separate sessionId and the resolved thinking preference from the Ollama request payload —
      // Ollama rejects unknown fields, and `think` is re-derived above (not forwarded raw).
      const { sessionId, think: _thinkPref, collection: _collectionFilter, ...ollamaRequest } = reqData

      // Save user message to DB before streaming if sessionId provided
      let userContent: string | null = null
      if (sessionId) {
        const lastUserMsg = [...reqData.messages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg) {
          userContent = lastUserMsg.content
          await this.chatService.addMessage(sessionId, 'user', userContent)
        }
      }

      // Size the context window, then make the prompt fit inside it.
      //
      // Nothing here ever set num_ctx, so every conversation ran at whatever
      // the backend defaults to and was truncated from the middle — dropping
      // recent history and retrieved context first, which is the worst part to
      // lose. planPrompt evicts whole turns oldest-first instead, in blocks so
      // the prefix stays stable for the KV cache, holds back a floor of room for
      // the answer, and caps generation (num_predict) at whatever the window
      // has left once the prompt is in, so it cannot run past the window.
      //
      // Applied AFTER the message above is written to the session, so history
      // always stores what the user actually typed rather than a trimmed copy.
      //
      // The retrieved-context block is part of systemBlocks here, so it is
      // still bounded only by the model-size tiers in rag_prompt.ts rather than
      // by this budget. Folding retrieval into the budget properly means moving
      // the injection point, which changes what reaches the model, so it wants
      // its own measured change.
      const contextWindow = await this.contextWindowService.windowFor(reqData.model)
      //
      // Images are counted here, not just attached later: they cost context that
      // no message shows, and without room held back for them the backend would
      // cut the prompt down around them from the middle. They are attached to the
      // question only after budgeting, so the planner never has to carry
      // megabytes of base64 around.
      const planned = planPrompt({
        ...splitForBudget(ollamaRequest.messages as BudgetMessage[]),
        ragChunks: [],
        renderRagBlock: () => '',
        contextWindow,
        imageCount: normalizedImages.length,
      })
      if (planned.trace.turnsDropped > 0 || planned.trace.queryTruncated) {
        logger.debug(
          `[OllamaController] Budgeted prompt for "${reqData.model}": window ${contextWindow}, ` +
            `${planned.trace.estimatedPromptTokens}/${planned.trace.promptBudget} tokens ` +
            `(${planned.trace.imageTokens} for ${normalizedImages.length} image(s)), ` +
            `${planned.trace.turnsDropped} turn(s) dropped, truncated=${planned.trace.queryTruncated}`
        )
      }
      const budgetedRequest = {
        ...ollamaRequest,
        messages: attachImagesToLatestUserMessage(planned.messages, normalizedImages) as Message[],
        options: { num_ctx: contextWindow, num_predict: planned.numPredict },
      }

      if (reqData.stream) {
        // The reader left while the question was being prepared. Their message
        // is saved above; starting the model now would only make the next
        // question wait behind an answer nobody will read.
        if (readerGone.signal.aborted) {
          logger.debug('[OllamaController] Client left before generation started; not starting it')
          return
        }
        logger.debug(`[OllamaController] Initiating streaming response for model: "${reqData.model}" with think: ${think}`)
        // Headers already flushed above
        let fullContent = ''
        // ollama-js ends the stream at the first chunk marked done, so exactly
        // one stop reason arrives. On oMLX the proxy stamps the token count on
        // a later [DONE] frame that ollama-js never reads, so the length-stop
        // log shows '?' for tokens there.
        let cutOff = false
        let completionTokens: number | undefined
        try {
          // Cancel only where the backend survives it (see cancel_safety.ts).
          // Without the signal, a reader who leaves costs one wasted answer, as
          // it did in every earlier release; with it, on an Ollama build that
          // predates the fix, it can leave the runner spinning until restarted.
          const cancelOnLeave = await this.ollamaService.canCancelGeneration()
          const stream = await this.ollamaService.chatStream(
            { ...budgetedRequest, think },
            cancelOnLeave ? readerGone.signal : undefined
          )
          for await (const chunk of stream) {
            if (chunk.message?.content) {
              fullContent += chunk.message.content
            }
            if (chunk.done_reason === 'length') cutOff = true
            if (typeof chunk.eval_count === 'number') completionTokens = chunk.eval_count
            response.response.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
        } catch (err) {
          // Aborting the request to Ollama surfaces here as an AbortError. The
          // partial answer is not saved: it ends mid-sentence with nothing to
          // say so, and nobody was reading it.
          if (readerGone.signal.aborted) {
            logger.debug('[OllamaController] Client disconnected; stopped generating')
            return
          }
          imageRequestRejected = normalizedImages.length > 0 && vision === 'unknown'
          throw err
        }
        // Trailing citation event, written before end(). It carries no `message`
        // key, which is how the client tells it apart from Ollama's own chunks.
        if (sources.length > 0) {
          response.response.write(`data: ${JSON.stringify({ sources })}\n\n`)
        }
        response.response.end()
        if (cutOff) {
          this._logLengthStop(reqData.model, contextWindow, planned.numPredict, completionTokens)
        }

        // Save assistant message and optionally generate title
        if (sessionId && fullContent) {
          await this.chatService.addMessage(sessionId, 'assistant', fullContent, sources)
          const messageCount = await this.chatService.getMessageCount(sessionId)
          if (messageCount <= 2 && userContent) {
            this.chatService.generateTitle(sessionId, userContent, fullContent, reqData.model).catch((err) => {
              logger.error(`[OllamaController] Title generation failed: ${err instanceof Error ? err.message : err}`)
            })
          }
        }
        return
      }

      // Non-streaming (legacy) path
      let result
      try {
        result = await this.ollamaService.chat({ ...budgetedRequest, think })
      } catch (err) {
        imageRequestRejected = normalizedImages.length > 0 && vision === 'unknown'
        throw err
      }
      if (result?.done_reason === 'length') {
        this._logLengthStop(reqData.model, contextWindow, planned.numPredict, result.eval_count)
      }

      if (sessionId && result?.message?.content) {
        await this.chatService.addMessage(sessionId, 'assistant', result.message.content, sources)
        const messageCount = await this.chatService.getMessageCount(sessionId)
        if (messageCount <= 2 && userContent) {
          this.chatService.generateTitle(sessionId, userContent, result.message.content, reqData.model).catch((err) => {
            logger.error(`[OllamaController] Title generation failed: ${err instanceof Error ? err.message : err}`)
          })
        }
      }

      return { ...result, sources }
    } catch (error) {
      if (reqData.stream) {
        // Headers are long gone, so the explanation rides in the event itself.
        const streamError = imageRequestRejected
          ? {
              error: true,
              message: unknownVisionFailureMessage(reqData.model, failureReason(error)),
            }
          : { error: true }
        response.response.write(`data: ${JSON.stringify(streamError)}\n\n`)
        response.response.end()
        return
      }
      if (imageRequestRejected) {
        return response.status(422).send({
          message: unknownVisionFailureMessage(reqData.model, failureReason(error)),
        })
      }
      throw error
    }
  }

  /**
   * A reply that hit the generation cap reaches the user cut off. The client
   * shows that from done_reason; this puts it in the admin log with the numbers
   * needed to tell a small window from a cap that is set too low (upstream
   * #1342).
   */
  private _logLengthStop(
    model: string,
    numCtx: number,
    numPredict: number,
    completionTokens: number | undefined
  ): void {
    logger.info(
      `[OllamaController] ${model} stopped at the length limit: ` +
        `${completionTokens ?? '?'} tokens generated, num_predict=${numPredict}, num_ctx=${numCtx}`
    )
  }

  async deleteModel({ request }: HttpContext) {
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.deleteModel(reqData.model)
    return {
      success: true,
      message: `Model deleted: ${reqData.model}`,
    }
  }

  async dispatchModelDownload({ request }: HttpContext) {
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.dispatchModelDownload(reqData.model)
    return {
      success: true,
      message: `Download job dispatched for model: ${reqData.model}`,
    }
  }

  async installedModels({ }: HttpContext) {
    const models = await this.ollamaService.getModels()
    // Enrich each model with what one /api/show call says about it, so the
    // settings/chat UI knows which models the thinking toggle (#1079) and image
    // attachments (edbfe1ad) apply to. getModelInfo memoizes, so this stays cheap
    // on repeat loads, and it is best-effort per model: a probe that fails
    // reports nothing known rather than failing the list.
    const infos = await Promise.all(models.map((m) => this.ollamaService.getModelInfo(m.name)))
    return models.map((m, i) => ({
      ...m,
      thinking: infos[i].hasThinking,
      vision: infos[i].vision ?? 'unknown',
    }))
  }

  private async rewriteQueryWithContext(
    messages: Message[],
    model: string
  ): Promise<string | null> {
    const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user')

    try {
      // Skip the entire RAG pipeline if there are no documents to search.
      const hasDocuments = await this.ragService.hasDocuments()
      if (!hasDocuments) {
        return null
      }

      // Get recent conversation history (last 6 messages for 3 turns)
      const recentMessages = messages.slice(-6)

      // Skip rewriting for short conversations. Rewriting adds latency with
      // little RAG benefit until there is enough context to matter.
      const userMessages = recentMessages.filter(msg => msg.role === 'user')
      if (userMessages.length <= 2) {
        return lastUserMessage?.content || null
      }

      const conversationContext = recentMessages
        .map(msg => {
          const role = msg.role === 'user' ? 'User' : 'Assistant'
          // Truncate assistant messages to first 200 chars to keep context manageable
          const content = msg.role === 'assistant'
            ? msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '')
            : msg.content
          return `${role}: "${content}"`
        })
        .join('\n')

      // The rewrite runs on the operator's tasks model when one is set (#1244).
      // With the setting unset (the default) it reuses the model the user is
      // already chatting with, so we don't force-load a separate model on every
      // message (heavy under MLX) — and because this is the most frequent
      // ancillary call of the three, it is also why an over-cap tasks model is
      // refused rather than honoured (see pickTasksModel).
      // No reasoning wanted: the rewritten query is embedded and matched against
      // Qdrant verbatim, so a thinking preamble is retrieval noise as well as
      // latency. OllamaService still strips inline <think> tags for the backends
      // that ignore this.
      const rewriteModel = (await this.chatService.resolveTasksModel(model)) ?? model

      const response = await this.ollamaService.chat({
        model: rewriteModel,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPTS.query_rewrite,
          },
          {
            role: 'user',
            content: `Conversation:\n${conversationContext}\n\nRewritten Query:`,
          },
        ],
        think: false,
      })

      const rewrittenQuery = response.message.content.trim()
      logger.info(`[RAG] Query rewritten: "${rewrittenQuery}"`)
      return rewrittenQuery
    } catch (error) {
      logger.error(
        `[RAG] Query rewriting failed: ${error instanceof Error ? error.message : error}`
      )
      // Fallback to last user message if rewriting fails
      return lastUserMessage?.content || null
    }
  }
}
