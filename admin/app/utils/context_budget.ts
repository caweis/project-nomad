/**
 * Token estimation and prompt budgeting for chat.
 *
 * Two upstream modules (`token_estimate.ts` and `context_budget.ts`) are merged
 * into this one file ON PURPOSE. Upstream's planner imports its estimator with
 * a `./token_estimate.js` specifier; in this fork that breaks the standalone
 * harness, because bare `node --experimental-strip-types` will not resolve a
 * `.js` specifier onto a `.ts` file, while `tsc` rejects the `.ts` form
 * outright (TS5097, and the build emits so `allowImportingTsExtensions` is not
 * available). Splitting these back into two files would silently cost the
 * budgeting math its test coverage — which is the coverage that matters most,
 * since this is the code that decides what the model is allowed to see.
 *
 * Everything below is pure: no I/O, no clock, no framework, no Adonis, no
 * Ollama client. That is what lets context_budget.standalone.ts exercise it.
 *
 * Ported from upstream #1253 (a02178d), with two defects fixed — see
 * ELISION_RESERVE and the query-truncation notice below.
 */

/**
 * Token estimation for prompt budgeting.
 *
 * NOMAD cannot tokenize exactly. The model's real vocabulary lives inside a GGUF
 * on the Ollama side, Ollama exposes no tokenize endpoint (ollama#12030 is still
 * open), and bundling a BPE vocabulary would mean shipping the *wrong* vocabulary
 * for whatever Llama/Qwen/Gemma/Granite model the user actually pulled. Fetching
 * the right one per model needs network access, which an offline-first appliance
 * does not have.
 *
 * So this estimates — but it estimates in a way that corrects itself. Two parts:
 *
 * 1. A structural segmenter (below). BPE vocabularies are built from natural text,
 *    so in practice a token is roughly "a word, or a punctuation mark, or a chunk
 *    of a long/rare word". Counting those directly tracks a real tokenizer far
 *    better than dividing character count by a constant, because the constant is
 *    only right for the kind of text it was tuned on. Prose runs ~4 chars/token;
 *    dense JSON, markdown tables and code run closer to 2.5. Those are exactly the
 *    payloads that overflow a window, so that is exactly where a fixed ratio is
 *    most wrong and most dangerous.
 *
 * 2. A per-model correction factor learned from ground truth. Every Ollama
 *    response reports `prompt_eval_count` — the real token count of the prompt we
 *    just sent. TokenCalibrationService folds the observed error into a per-model
 *    EWMA and feeds it back here as `ratio`. Costs nothing: no extra inference, no
 *    extra dependency, and it converges on the actual tokenizer within a couple of
 *    turns.
 *
 * Measured against real `prompt_eval_count` over a six-fixture set (prose,
 * markdown table, TypeScript, JSON, bullet list, mixed long-form), mean absolute
 * error after per-model calibration:
 *
 *     llama3:8b       segmenter  5.7%   chars/3.5  18.0%
 *     qwen2.5:0.5b    segmenter  6.2%   chars/3.5  20.0%
 *     granite4.1:8b   segmenter  6.7%   chars/3.5  18.4%
 *
 * The learned factors were k=1.02, k=1.26 and k=1.00 respectively — which is the
 * argument for making it per-model rather than a global constant. Qwen tokenizes
 * noticeably finer than Llama, and no single tuned divisor can serve both.
 *
 * Kept pure and dependency-free so it runs under bare `node --test`, the same
 * convention as `rag_prompt.ts`.
 */

/**
 * Chars-per-token used by the *ingestion* path when sizing chunks for the
 * embedding model.
 *
 * Deliberately unchanged from RagService's historical value. Chunk size is baked
 * into the eval corpus fingerprint, so touching it re-chunks the corpus and
 * invalidates every committed retrieval baseline. Re-tuning it is a legitimate
 * change, but it is a *retrieval* change and belongs to its own measured PR — not
 * folded silently into a context-management refactor. Re-exported here only so
 * there is one obvious place to find every token constant.
 */
export const INGEST_CHARS_PER_TOKEN = 2

/**
 * Per-message overhead from the chat template: role marker, turn delimiters, and
 * the trailing newline the template adds. Real templates cost roughly 3-5 tokens
 * a message. The old char-based math ignored this entirely, which quietly
 * under-counted a 40-turn conversation by well over a hundred tokens.
 */
export const PER_MESSAGE_OVERHEAD_TOKENS = 4

/** Tokens the template adds once, for the generation prompt that follows the messages. */
export const CONVERSATION_OVERHEAD_TOKENS = 3

/**
 * Safety margin applied when a budget decision must not overflow.
 *
 * Under-estimating is strictly worse than over-estimating: an over-estimate wastes
 * a little window, an under-estimate overflows it and hands the backend a silent
 * truncation — the exact failure this whole subsystem exists to prevent.
 */
export const ESTIMATE_SAFETY_MARGIN = 1.1

/**
 * Character-class fragments, kept as strings so the CJK ranges appear exactly
 * once and the regexes below stay readable.
 */
const CJK = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af'
const WORD = 'A-Za-z0-9\\u00c0-\\u024f'

/**
 * Segments that a BPE tokenizer tends to split on. Order matters: the first
 * alternative that matches wins.
 *
 * - CJK/Hangul codepoints are usually one token each (often more), so they are
 *   matched singly rather than as words.
 * - Runs of letters/digits are word-ish; long ones get sub-split below.
 * - Runs of punctuation/symbols are matched as a *run*, not per character. BPE
 *   vocabularies contain merged punctuation pieces (`":`, `",`, `);`, `],`), so
 *   charging one token per punctuation character over-counts structured text
 *   badly -- measured at +48% on a JSON payload before this was split out.
 */
const SEGMENT_RE = new RegExp(`[${CJK}]|[${WORD}]+|[^\\s${WORD}${CJK}]+`, 'gu')

/** Identifies the punctuation-run alternative when walking matches. */
const PUNCT_RUN_RE = new RegExp(`^[^\\s${WORD}${CJK}]+$`, 'u')

/**
 * Above this length, a run of letters/digits is a rare word, an identifier, or a
 * hash, and a real tokenizer will break it into several pieces.
 */
const LONG_WORD_CHARS = 7

/** Roughly how many characters of a punctuation run one merged token covers. */
const PUNCT_CHARS_PER_TOKEN = 2

/**
 * Estimate the token count of a string.
 *
 * `ratio` is the learned per-model correction (1.0 = uncalibrated). Pass the value
 * from TokenCalibrationService.ratioFor(model).
 */
export function estimateTokens(text: string, ratio = 1): number {
  if (!text) return 0

  let tokens = 0
  const matches = text.match(SEGMENT_RE)
  if (matches) {
    for (const segment of matches) {
      if (PUNCT_RUN_RE.test(segment)) {
        // Punctuation merges: `":` and `},` are usually single tokens.
        tokens += Math.ceil(segment.length / PUNCT_CHARS_PER_TOKEN)
      } else if (segment.length > LONG_WORD_CHARS) {
        // Long words split into roughly one piece per LONG_WORD_CHARS characters.
        tokens += Math.ceil(segment.length / LONG_WORD_CHARS)
      } else {
        tokens += 1
      }
    }
  }

  // Leading whitespace is folded into the following token by most BPE
  // vocabularies, but newlines are usually tokens in their own right and matter
  // for the markdown-heavy content NOMAD deals in.
  const newlines = (text.match(/\n/g) || []).length
  tokens += newlines

  return Math.max(1, Math.ceil(tokens * ratio))
}

export type EstimatableMessage = { role: string; content: string }

/**
 * Estimate the token cost of a full message array as the backend will see it,
 * including chat-template overhead.
 */
export function estimateMessagesTokens(messages: EstimatableMessage[], ratio = 1): number {
  if (messages.length === 0) return 0
  let total = CONVERSATION_OVERHEAD_TOKENS
  for (const message of messages) {
    total += estimateTokens(message.content, ratio) + PER_MESSAGE_OVERHEAD_TOKENS
  }
  return total
}

/**
 * Estimate with the safety margin applied — use this wherever exceeding the
 * budget causes silent truncation rather than merely wasting space.
 */
export function estimateTokensConservative(text: string, ratio = 1): number {
  return Math.ceil(estimateTokens(text, ratio) * ESTIMATE_SAFETY_MARGIN)
}

/**
 * Fold a fresh observation into an exponentially-weighted moving average.
 *
 * `alpha` is intentionally low: a single odd turn (a huge code paste, a burst of
 * CJK) should nudge the ratio, not redefine it.
 */
export function updateEwma(previous: number | null, observed: number, alpha = 0.25): number {
  if (previous === null || !Number.isFinite(previous) || previous <= 0) return observed
  return previous * (1 - alpha) + observed * alpha
}

/**
 * Guard rail on the learned ratio. A calibration ratio far outside this range
 * means something other than tokenization differs — a backend injecting a hidden
 * system prompt, a tool schema we didn't count, a reasoning preamble. Clamping
 * keeps one bad reading from destroying the budget for every later turn.
 */
export const MIN_CALIBRATION_RATIO = 0.5
export const MAX_CALIBRATION_RATIO = 2.5

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  return Math.min(MAX_CALIBRATION_RATIO, Math.max(MIN_CALIBRATION_RATIO, ratio))
}

/**
 * Decides what actually goes into the prompt, and what gets left out.
 *
 * Before this existed, nothing trimmed anything: the browser posted the whole
 * session, the pipeline copied it verbatim, and overflow was left to the
 * backend. That is the worst possible arrangement, because backend truncation is
 * *silent* and *positional* — llama.cpp drops from the middle of the window, so
 * what gets discarded is conversation history and retrieved knowledge-base
 * context, while the model gives no indication anything is missing. Measured on
 * a live Ollama, a 7,000-token prompt came back having processed 2,060 tokens,
 * and the model confabulated an answer from the fragment that survived.
 *
 * So the rule here is: never hand the backend more than it can hold. Decide
 * explicitly what to drop, drop it in a way the model can reason about, and
 * record what happened so the eval harness can see it.
 *
 * Allocation order, most protected first:
 *   1. Response reserve  — tokens held back for the answer itself.
 *   2. Fixed blocks      — system prompts and the current question. Never dropped.
 *   3. Retrieved context — whole chunks, best-first, until its share is spent.
 *   4. History           — whole turns, newest-first, into whatever remains.
 *
 * Pure and dependency-free so it runs under bare `node --test`, the same
 * convention as `rag_prompt.ts`.
 */


export type BudgetRole = 'system' | 'user' | 'assistant'
export type BudgetMessage = { role: BudgetRole; content: string }

/** A retrieved chunk, already ranked — index 0 is the best match. */
export type BudgetChunk = { text: string; metadata?: Record<string, any> }

/**
 * Where the per-turn retrieved-context block goes.
 *
 * `tail` places it immediately before the current question, leaving
 * [system][history] as a byte-identical prefix across turns so the backend can
 * reuse its KV cache. `front` is the historical behaviour: a system message
 * ahead of all history, which changes content every turn and therefore
 * invalidates the cached prefix for the entire conversation behind it.
 *
 * The common advice to "inject RAG into the system prompt" assumes the context
 * is fixed for the session (an attached document), where a fixed position does
 * preserve the prefix. When context is re-retrieved every turn, the opposite is
 * true. Both are kept so `eval:generation` can measure the difference rather
 * than the choice resting on argument alone.
 */
export type RagPlacement = 'tail' | 'front'

export type BudgetInputs = {
  /** Stable system blocks (NOMAD.md, formatting rules), in final order. */
  systemBlocks: BudgetMessage[]
  /** Prior conversation, oldest first, excluding the current question. */
  history: BudgetMessage[]
  /** The current user message. Never dropped. */
  query: BudgetMessage
  /** Retrieved chunks, best first. May be empty. */
  ragChunks: BudgetChunk[]
  /** Renders surviving chunks into the final context message. */
  renderRagBlock: (chunks: BudgetChunk[]) => string
  /** The resolved context window, in tokens. */
  contextWindow: number
  /** Learned per-model token-estimator correction. */
  ratio?: number
  ragPlacement?: RagPlacement
  /** Overrides for the response reserve and RAG share; mostly for tests. */
  responseReserve?: number
  ragShare?: number
}

export type BudgetTrace = {
  contextWindow: number
  responseReserve: number
  promptBudget: number
  estimatedPromptTokens: number
  systemTokens: number
  queryTokens: number
  ragTokens: number
  historyTokens: number
  chunksKept: number
  chunksDropped: number
  turnsKept: number
  turnsDropped: number
  historyElided: boolean
  queryTruncated: boolean
  ragPlacement: RagPlacement
}

export type BudgetResult = {
  messages: BudgetMessage[]
  trace: BudgetTrace
  /** What to send as num_predict, so generation can't run past the window. */
  numPredict: number
}

/** Ceiling on tokens reserved for the answer. */
export const MAX_RESPONSE_RESERVE = 1024
/** Share of the window reserved for the answer when that is smaller. */
export const RESPONSE_RESERVE_FRACTION = 0.25
/** Share of the remaining budget the retrieved context may claim. */
export const DEFAULT_RAG_SHARE = 0.35

/**
 * Marker inserted where turns were dropped.
 *
 * Worth the handful of tokens: without it the model sees a conversation that
 * appears to begin mid-thought and has no way to tell that it is missing
 * context, which is exactly when small models start confidently inventing what
 * "we discussed earlier".
 */
export const ELISION_MARKER =
  '[Earlier messages in this conversation have been omitted to fit the context window.]'

/**
 * Appended to a single question so large it does not fit the window on its own.
 *
 * Visible on purpose. Silently answering half a question is worse than saying
 * the question was cut, particularly on a box where the user cannot check the
 * answer against anything else.
 */
export const TRUNCATION_NOTICE =
  '\n\n[This message was truncated because it exceeds the context window.]'

/**
 * Turns are dropped in blocks rather than one at a time.
 *
 * Dropping a single turn per request would shift the prompt prefix on *every*
 * subsequent turn, invalidating the backend's KV cache each time — trading a
 * small saving in tokens for a full re-prefill. Dropping several at once means
 * the prefix then stays stable for several turns.
 */
export const HISTORY_EVICTION_BLOCK = 4

/**
 * Group a flat message list into whole turns.
 *
 * A turn is a user message plus everything that answers it. Truncating on a
 * message boundary instead can leave the transcript starting with an assistant
 * reply to a question the model can no longer see — which reads, to the model,
 * as though it said something unprompted.
 */
export function groupIntoTurns(history: BudgetMessage[]): BudgetMessage[][] {
  const turns: BudgetMessage[][] = []
  for (const message of history) {
    if (message.role === 'user' || turns.length === 0) {
      turns.push([message])
    } else {
      turns[turns.length - 1].push(message)
    }
  }
  return turns
}

/**
 * Plan the prompt.
 *
 * Never returns a message array estimated to exceed `contextWindow -
 * responseReserve`, except in the degenerate case where the fixed blocks alone
 * are too large — and in that case the query is truncated visibly rather than
 * being handed to the backend to cut silently.
 */
export function planPrompt(inputs: BudgetInputs): BudgetResult {
  const ratio = inputs.ratio ?? 1
  const placement = inputs.ragPlacement ?? 'tail'
  const contextWindow = inputs.contextWindow

  const responseReserve =
    inputs.responseReserve ??
    Math.max(256, Math.min(MAX_RESPONSE_RESERVE, Math.floor(contextWindow * RESPONSE_RESERVE_FRACTION)))
  const promptBudget = Math.max(0, contextWindow - responseReserve)

  const cost = (messages: BudgetMessage[]) => estimateMessagesTokens(messages, ratio)

  // --- Fixed blocks: system prompts and the question --------------------
  const systemTokens = cost(inputs.systemBlocks)
  let query = inputs.query
  let queryTokens = cost([query])
  let queryTruncated = false

  // Degenerate case: the system prompts plus the question alone overflow the
  // window. Truncating here is a bad outcome, but it is a *visible* one — the
  // alternative is the backend silently cutting the question in half.
  if (systemTokens + queryTokens > promptBudget) {
    const available = Math.max(0, promptBudget - systemTokens)
    if (available > 0) {
      const perToken = query.content.length / Math.max(1, estimateTokens(query.content, ratio))

      // FORK FIX (upstream #1253 defect): upstream budgets this cut purely in
      // characters — `floor(available * perToken) - ELISION_MARKER.length` —
      // which gets two things wrong. It subtracts the length of the *elision*
      // marker while appending the (different, shorter) truncation notice, and
      // it never accounts for the per-message and conversation overhead that
      // `cost()` charges on top of the content. The result still overran the
      // budget, by 5 tokens on a 4096 window.
      //
      // Budget in tokens instead: take the message overhead and the notice off
      // the top, then convert what is left back into characters.
      const messageOverhead = cost([{ ...query, content: '' }])
      const noticeTokens = estimateTokens(TRUNCATION_NOTICE, ratio)
      const contentTokens = Math.max(0, available - messageOverhead - noticeTokens)
      const keepChars = Math.max(0, Math.floor(contentTokens * perToken))

      query = {
        ...query,
        content: query.content.slice(0, keepChars) + TRUNCATION_NOTICE,
      }
      queryTokens = cost([query])
      queryTruncated = true
    }
  }

  let remaining = promptBudget - systemTokens - queryTokens

  // --- Retrieved context: whole chunks, best first ----------------------
  //
  // Whole chunks, deliberately. The previous behaviour capped on a running
  // character count, which could hand the model a chunk cut off mid-sentence —
  // the worst of both worlds, since it costs tokens without carrying a complete
  // fact. A chunk that doesn't fit is dropped, not shortened.
  const ragBudget = Math.max(0, Math.floor(Math.max(0, remaining) * (inputs.ragShare ?? DEFAULT_RAG_SHARE)))
  const keptChunks: BudgetChunk[] = []
  let ragTokens = 0

  if (inputs.ragChunks.length > 0 && ragBudget > 0) {
    for (const chunk of inputs.ragChunks) {
      const candidate = [...keptChunks, chunk]
      const rendered = inputs.renderRagBlock(candidate)
      const candidateTokens = cost([{ role: 'system', content: rendered }])
      if (candidateTokens <= ragBudget) {
        keptChunks.push(chunk)
        ragTokens = candidateTokens
      }
      // Keep scanning: a later, smaller chunk may still fit where this one didn't.
    }
  }

  const ragMessage: BudgetMessage | null =
    keptChunks.length > 0
      ? { role: 'system', content: inputs.renderRagBlock(keptChunks) }
      : null

  remaining -= ragTokens

  // --- History: whole turns, newest first -------------------------------
  const turns = groupIntoTurns(inputs.history)

  /** Fit the newest turns into `budget`, dropping oldest-first. */
  const fitHistory = (budget: number) => {
    const kept: BudgetMessage[][] = []
    let tokens = 0
    for (let i = turns.length - 1; i >= 0; i--) {
      const turnTokens = cost(turns[i])
      if (tokens + turnTokens > budget) break
      kept.unshift(turns[i])
      tokens += turnTokens
    }
    return { kept, tokens }
  }

  // FORK FIX (upstream #1253 defect): upstream fits history against the whole
  // remaining budget and then pushes ELISION_MARKER into the prompt without
  // ever charging for it, so any conversation that elides overruns promptBudget
  // by the marker's cost. The overrun is small and intermittent, because the
  // fit loop usually stops a whole turn short of the budget and absorbs it.
  //
  // Fit once; if anything was dropped then the marker is going in, so re-fit
  // against a budget that has already paid for it. Taking the reserve only when
  // it is actually spent means a conversation that fits whole loses no history.
  let { kept: keptTurns, tokens: historyTokens } = fitHistory(remaining)
  if (keptTurns.length < turns.length) {
    const elisionCost = cost([{ role: 'system' as const, content: ELISION_MARKER }])
    ;({ kept: keptTurns, tokens: historyTokens } = fitHistory(Math.max(0, remaining - elisionCost)))
  }

  const turnsDropped = turns.length - keptTurns.length

  // Chunky eviction: once we're dropping anything, drop a whole block, so the
  // surviving prefix stays put for the next several turns instead of shifting
  // on every request and forcing a re-prefill each time.
  if (turnsDropped > 0 && keptTurns.length > 0) {
    const overshoot = turnsDropped % HISTORY_EVICTION_BLOCK
    const extra = overshoot === 0 ? 0 : HISTORY_EVICTION_BLOCK - overshoot
    for (let i = 0; i < extra && keptTurns.length > 1; i++) {
      const removed = keptTurns.shift()!
      historyTokens -= cost(removed)
    }
  }

  const historyElided = keptTurns.length < turns.length
  const historyMessages = keptTurns.flat()

  // --- Assemble, stability-descending -----------------------------------
  const messages: BudgetMessage[] = []
  messages.push(...inputs.systemBlocks)
  if (historyElided) {
    messages.push({ role: 'system', content: ELISION_MARKER })
  }

  if (placement === 'front' && ragMessage) {
    // Historical ordering, kept only so the two can be compared under eval.
    messages.splice(inputs.systemBlocks.length, 0, ragMessage)
    messages.push(...historyMessages)
  } else {
    messages.push(...historyMessages)
    if (ragMessage) messages.push(ragMessage)
  }
  messages.push(query)

  const estimatedPromptTokens = cost(messages)

  return {
    messages,
    numPredict: responseReserve,
    trace: {
      contextWindow,
      responseReserve,
      promptBudget,
      estimatedPromptTokens,
      systemTokens,
      queryTokens,
      ragTokens,
      historyTokens,
      chunksKept: keptChunks.length,
      chunksDropped: inputs.ragChunks.length - keptChunks.length,
      turnsKept: keptTurns.length,
      turnsDropped: turns.length - keptTurns.length,
      historyElided,
      queryTruncated,
      ragPlacement: placement,
    },
  }
}
