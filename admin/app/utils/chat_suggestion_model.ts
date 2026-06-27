export interface SuggestionModel {
  name: string
  size: number
}

/**
 * Pick the model that should answer the short chat-suggestion prompt.
 *
 * Prefer the user's currently-selected chat model (chat.lastModel). If it is
 * unset or no longer installed, fall back to the SMALLEST installed model.
 *
 * The old behaviour picked the LARGEST model by file size, which is unsafe: if
 * an installed model exceeds available VRAM (e.g. llama3.1:405b), Ollama spends
 * minutes loading it and the suggestions request 500s, which hangs the chat
 * page. Suggestions are short prompts that don't benefit from a flagship model,
 * and getModels() already excludes embedders so the smallest is a chat model.
 *
 * Ported from upstream 2ae30a4.
 */
export function chooseSuggestionModel<T extends SuggestionModel>(
  models: T[],
  lastModel: string | null
): T | undefined {
  if (models.length === 0) return undefined
  const preferred = lastModel ? models.find((m) => m.name === lastModel) : undefined
  return preferred ?? models.reduce((prev, current) => (prev.size < current.size ? prev : current))
}
