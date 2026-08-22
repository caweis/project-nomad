/**
 * Pure prompt-budgeting helpers for the chat RAG pipeline.
 *
 * These live here rather than on the controller so they can be exercised under
 * bare `node --experimental-strip-types` with no MySQL, Redis, Qdrant or Ollama
 * — the same reason `kb_ratio_lookup.ts` and `rag_toggle.ts` are shaped this
 * way. The caller supplies the config; everything below is a function of its
 * arguments.
 *
 * NOTE — this module must stay import-free. `tsc` rejects a `.ts` import
 * specifier (TS5097 without `allowImportingTsExtensions`, which the build
 * cannot enable because it emits), while bare `node --experimental-strip-types`
 * will not resolve a `.js` specifier onto a `.ts` file. A relative import of
 * either form therefore breaks one side or the other, so the rendering half of
 * this pipeline lives in `rag_context.ts` beside the labelling rule it needs.
 *
 * Extracted verbatim from OllamaController.chat, which had grown a prompt
 * pipeline inline with no way to test it. Behaviour is preserved exactly,
 * including the two quirks called out below — each is worth fixing, and each
 * changes what the model sees, so they are left for a measured change rather
 * than folded into a refactor.
 *
 * Ported from upstream #1233, adapted: upstream's `buildContextBlock` inlines
 * its own label, while this fork already had `buildContextLabel` (upstream
 * b8961d2) doing the identical job — so this calls that rather than growing a
 * second copy of the labelling rule.
 */

/**
 * Chars-per-token estimate used when budgeting the *prompt*.
 *
 * KNOWN DIVERGENCE, deliberately preserved: `RagService.CHAR_TO_TOKEN_RATIO` is
 * 2.5, not 4. The two halves of the system disagree about what a token costs,
 * and they disagree in the unsafe direction — RagService was tightened from 3
 * to 2.5 precisely because char-based estimates undercount on dense content
 * (HTML, German, code-heavy ZIMs) and produced "input length exceeds the
 * context length" 400s from Ollama. At 4 this side undercounts harder still.
 *
 * Left alone here because changing it changes which chunks reach the model, and
 * that belongs in a change that can measure the difference rather than in an
 * extraction that must not move behaviour.
 */
export const PROMPT_CHARS_PER_TOKEN = 4

export type ContextLimits = { maxResults: number; maxTokens: number }
export type ContextLimitTier = { maxParams: number; maxResults: number; maxTokens: number }

/** The minimum shape these helpers need; real retrieved chunks carry more. */
export type BudgetableChunk = { text: string; metadata?: Record<string, any> }

/**
 * Determine RAG context limits from the parameter count encoded in a model
 * name — "llama3.2:3b", "qwen2.5:1.5b", "gemma:7b".
 *
 * PRESERVED QUIRK: an unparseable name is treated as 8B. That is a guess, and
 * for "phi3", "mistral-nemo" or a custom tag it can hand a small model far more
 * context than it can actually hold. Faithful to the pre-extraction behaviour.
 * (`chat_suggestion_model.effectiveSizeBytes` solves the same problem better,
 * by falling back to reported byte size — worth reconciling, separately.)
 */
export function getContextLimitsForModel(
  modelName: string,
  tiers: readonly ContextLimitTier[]
): ContextLimits {
  const sizeMatch = modelName.match(/(\d+\.?\d*)[bB]/)
  const paramBillions = sizeMatch ? Number.parseFloat(sizeMatch[1]) : 8

  for (const tier of tiers) {
    if (paramBillions <= tier.maxParams) {
      return { maxResults: tier.maxResults, maxTokens: tier.maxTokens }
    }
  }

  return { maxResults: 5, maxTokens: 0 }
}

/**
 * Apply the model-size context budget: cap the result count, then cap total
 * characters. `maxTokens <= 0` means "no character cap" (the 13B+ tier).
 *
 * The first (most relevant) result is always kept — the cap only gates
 * subsequent results, so one oversized chunk never starves the model of context
 * entirely.
 *
 * PRESERVED QUIRK: the running total is incremented *before* the test, so the
 * chunk that crosses the cap is itself excluded while still counting against
 * it. Faithful to the pre-extraction behaviour.
 */
export function trimToContextBudget<T extends BudgetableChunk>(
  docs: T[],
  limits: ContextLimits
): T[] {
  const byCount = docs.slice(0, limits.maxResults)
  if (limits.maxTokens <= 0) return byCount

  const charCap = limits.maxTokens * PROMPT_CHARS_PER_TOKEN
  let totalChars = 0
  return byCount.filter((doc, idx) => {
    totalChars += doc.text.length
    return idx === 0 || totalChars <= charCap
  })
}
