export interface SuggestionModel {
  name: string
  size: number
}

/**
 * Hard cap on the model allowed to answer the throwaway chat-suggestion
 * prompt, in (effective) bytes. Anything larger risks a multi-minute load
 * that wedges the chat page — suggestions are decorative and never worth
 * loading a big model for.
 */
export const SUGGESTION_MODEL_MAX_BYTES = 9_000_000_000

/**
 * Parse a parameter-count hint (in billions) from an Ollama-style model name:
 * "gemma3:1b" → 1, "deepseek-r1:32b" → 32, "qwen2.5:0.5b" → 0.5.
 * Returns null when the name carries no hint ("mistral-nemo", "phi3").
 * Leading token boundaries keep "deepseek-r1" from reading as a 1B hint.
 */
export function parseParamsBillion(name: string): number | null {
  const match = name.toLowerCase().match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?![a-z0-9])/)
  return match ? Number.parseFloat(match[1]) : null
}

/**
 * Effective on-disk size for ranking/capping. Real size wins when the backend
 * reports one; oMLX reports size 0 for every model, so fall back to the
 * name's parameter hint at ~0.7 GB per billion params (q4-ish density —
 * ranking-grade, not an exact figure). No size and no hint → treat as huge,
 * so unknown models are never picked for suggestions.
 */
export function effectiveSizeBytes(model: SuggestionModel): number {
  if (model.size > 0) return model.size
  const paramsB = parseParamsBillion(model.name)
  return paramsB !== null ? paramsB * 700_000_000 : Number.POSITIVE_INFINITY
}

/**
 * Pick the model that should answer the short chat-suggestion prompt.
 *
 * Only models within SUGGESTION_MODEL_MAX_BYTES are eligible — including the
 * user's selected chat model (chat.lastModel). Prefer that model when it is
 * eligible (it may already be loaded), otherwise the smallest eligible model,
 * and undefined when nothing qualifies (the caller returns no suggestions —
 * strictly better than a hung request).
 *
 * The original port preferred lastModel unconditionally and ranked fallbacks
 * by raw `size`. Both broke on the live appliance: lastModel was a 32B model,
 * and oMLX reports size 0 for every model, so the "smallest" reduce
 * degenerated to first-in-list — also the 32B. Ollama then spent minutes
 * loading it and the chat page hung on "Thinking".
 *
 * Ported from upstream 2ae30a4, then adapted as above.
 */
export function chooseSuggestionModel<T extends SuggestionModel>(
  models: T[],
  lastModel: string | null
): T | undefined {
  const eligible = models.filter((m) => effectiveSizeBytes(m) <= SUGGESTION_MODEL_MAX_BYTES)
  if (eligible.length === 0) return undefined
  const preferred = lastModel ? eligible.find((m) => m.name === lastModel) : undefined
  return (
    preferred ??
    eligible.reduce((prev, current) =>
      effectiveSizeBytes(prev) <= effectiveSizeBytes(current) ? prev : current
    )
  )
}
