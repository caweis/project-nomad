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

export type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OllamaChatRequest = {
  model: string
  messages: OllamaChatMessage[]
  stream?: boolean
  sessionId?: number
}

export type OllamaChatResponse = {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
}
