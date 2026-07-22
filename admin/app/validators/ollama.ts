import vine from '@vinejs/vine'

export const chatSchema = vine.compile(
  vine.object({
    model: vine.string().trim().minLength(1),
    messages: vine.array(
      vine.object({
        role: vine.enum(['system', 'user', 'assistant'] as const),
        content: vine.string(),
      })
    ),
    stream: vine.boolean().optional(),
    sessionId: vine.number().positive().optional(),
    // Effective per-request thinking preference (per-model override or global
    // default), resolved client-side. Omitted → server falls back to the
    // ai.autoThinking KV default. Ported from upstream #1079.
    think: vine.boolean().optional(),
    // KB subject tag to scope RAG retrieval to (upstream #1063). Omitted or
    // empty → search the whole knowledge base.
    collection: vine.string().trim().maxLength(40).optional(),
  })
)

export const getAvailableModelsSchema = vine.compile(
  vine.object({
    sort: vine.enum(['pulls', 'name'] as const).optional(),
    recommendedOnly: vine.boolean().optional(),
    query: vine.string().trim().optional(),
    limit: vine.number().positive().optional(),
    force: vine.boolean().optional(),
  })
)
