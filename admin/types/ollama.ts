import type { ModelResponse } from 'ollama'

export type NomadOllamaModel = {
  id: string
  name: string
  description: string
  estimated_pulls: string
  model_last_updated: string
  first_seen: string
  tags: NomadOllamaModelTag[]
  /**
   * oMLX backend only: the exact model_map.json key the oMLX proxy can pull
   * for this model — the smallest pullable MLX variant whose family (base name)
   * matches. Set by OllamaService.getAvailableModels when NOMAD_AI_BACKEND ===
   * 'omlx'; left undefined on the 'ollama' backend (where every catalog model
   * is pullable directly). When this is undefined in oMLX mode, the model has
   * no MLX conversion and its install controls are disabled in the UI. The UI
   * sends this value (not the catalog name/tag) so a selectable model always
   * resolves at the proxy — see the symmetry contract in nomad_pull.py.
   */
  mlxPullName?: string
}

export type NomadOllamaModelTag = {
  name: string
  size: string
  context: string
  input: string
  cloud: boolean
  thinking: boolean
}

export type NomadOllamaModelAPIResponse = {
  success: boolean
  message: string
  models: NomadOllamaModel[]
}

/**
 * A model from the installed-models endpoint: what Ollama lists, plus what the
 * endpoint adds from /api/show so the chat picker knows which models the
 * thinking toggle and image attachments apply to.
 */
export type NomadInstalledModel = ModelResponse & {
  thinking?: boolean
  vision?: ModelVisionCapability
}

export type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OllamaChatRequest = {
  model: string
  messages: OllamaChatMessage[]
  stream?: boolean
  sessionId?: number
  // Effective per-request thinking preference (per-model override or global
  // default). Omitted → server falls back to the ai.autoThinking KV default. #1079
  think?: boolean
  // KB subject tag to scope RAG retrieval to. Omitted → whole knowledge base. #1063
  collection?: string
}

/**
 * Whether a model accepts images. 'unknown' is an answer, not a failed lookup:
 * the oMLX proxy fills /api/show with a placeholder capability list that never
 * includes vision, and an Ollama older than its `capabilities` field says
 * nothing at all. Reading either as 'unsupported' would lock image upload for
 * models that can use it, so the attempt is allowed and the failure explained.
 */
export type ModelVisionCapability = 'supported' | 'unsupported' | 'unknown'

export type OllamaChatResponse = {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
}

/**
 * What a single /api/show call tells us about an installed model.
 *
 * Every field beyond `hasThinking` is optional because the oMLX proxy answers
 * /api/show with a much thinner body than Ollama does — no `capabilities`, and
 * often no `model_info`. A missing field means "not known", never "zero", and
 * the context-window resolver treats it that way.
 */
export interface NomadModelInfo {
  hasThinking: boolean
  /** Whether the model accepts images. Absent means 'unknown'. */
  vision?: ModelVisionCapability
  /** Trained context length from model_info, e.g. `llama.context_length`. */
  contextLength?: number
  /** num_ctx baked into the modelfile, treated as the author's ceiling hint. */
  modelfileNumCtx?: number
  /** e.g. "8.0B" — used to estimate KV cost when model_info is unavailable. */
  parameterSize?: string
  quantizationLevel?: string
  /** Raw model_info, for exact KV-cache sizing when the metadata is complete. */
  rawModelInfo?: unknown
}
