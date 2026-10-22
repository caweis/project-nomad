import { NomadOllamaModel, type ResponseStyle, type SamplerProfile } from '../types/ollama.js'

export const SAMPLER_PRESETS: Record<Exclude<ResponseStyle, 'off'>, SamplerProfile> = {
  auto: { temperature: 0.6, topP: 1, topK: 40, minP: 0.05, repeatPenalty: 1.1, compatTopP: 0.9 },
  focused: { temperature: 0.2, topP: 1, topK: 40, minP: 0.1, repeatPenalty: 1.05, compatTopP: 0.85 },
  creative: { temperature: 1, topP: 1, topK: 100, minP: 0.03, repeatPenalty: 1.15, compatTopP: 0.95 },
}
export const DEFAULT_RESPONSE_STYLE: ResponseStyle = 'auto'
export const RESPONSE_STYLE_PRESETS: { value: ResponseStyle; label: string }[] = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'focused', label: 'Focused (factual, repeatable)' },
  { value: 'creative', label: 'Creative (varied, exploratory)' },
  { value: 'off', label: 'Backend defaults' },
]

/**
 * Per-model description overrides applied at the catalog layer
 * (ollama_service.retrieveAndRefreshModels). Upstream descriptions
 * sometimes oversell what we actually pull — e.g. deepseek-r1's
 * description references 671B-class capability but our default tag
 * is the 1.5B variant. These overrides tell the truth about the tag
 * the wizard will pull.
 *
 * Add an entry whenever you spot a recommended model where the
 * description doesn't match the default tag's actual capability.
 */
export const MODEL_DESCRIPTION_OVERRIDES: Record<string, string> = {
  'llama3.1':
    "Llama 3.1 8B — Meta's general-purpose chat model in a size that runs comfortably on consumer Macs. Strong instruction-following, multilingual.",
  'deepseek-r1':
    "DeepSeek-R1 1.5B — a small distilled reasoning model. Useful for testing the AI Assistant; larger DeepSeek-R1 variants (7B, 14B, 32B, 671B) have stronger reasoning but require more RAM. Pull the bigger variants from the AI Settings page if your Mac has the memory.",
}

/**
 * Fallback basic recommended Ollama models in case fetching from the service fails.
 * Descriptions reflect the SPECIFIC tag we pull, not the upstream model family.
 */
export const FALLBACK_RECOMMENDED_OLLAMA_MODELS: NomadOllamaModel[] = [
  {
    name: 'llama3.1',
    description:
      "Llama 3.1 8B — Meta's general-purpose chat model in a size that runs comfortably on consumer Macs. Strong instruction-following, multilingual.",
    estimated_pulls: '109.3M',
    id: '9fe9c575-e77e-4a51-a743-07359458ee71',
    first_seen: '2026-01-28T23:37:31.000+00:00',
    model_last_updated: '1 year ago',
    tags: [
      {
        name: 'llama3.1:8b-text-q4_1',
        size: '5.1 GB',
        context: '128k',
        input: 'Text',
        cloud: false,
        thinking: false
      },
    ],
  },
  {
    name: 'deepseek-r1',
    description:
      'DeepSeek-R1 1.5B — a small distilled reasoning model. Useful for testing the AI Assistant; larger DeepSeek-R1 variants (7B, 14B, 32B, 671B) have stronger reasoning but require more RAM. Pull the bigger variants from the AI Settings page if your Mac has the memory.',
    estimated_pulls: '77.2M',
    id: '0b566560-68a6-4964-b0d4-beb3ab1ad694',
    first_seen: '2026-01-28T23:37:31.000+00:00',
    model_last_updated: '7 months ago',
    tags: [
      {
        name: 'deepseek-r1:1.5b',
        size: '1.1 GB',
        context: '128k',
        input: 'Text',
        cloud: false,
        thinking: true
      },
    ],
  },
  {
    name: 'llama3.2',
    description: "Meta's Llama 3.2 goes small with 1B and 3B models.",
    estimated_pulls: '54.7M',
    id: 'c9a1bc23-b290-4501-a913-f7c9bb39c3ad',
    first_seen: '2026-01-28T23:37:31.000+00:00',
    model_last_updated: '1 year ago',
    tags: [
      {
        name: 'llama3.2:1b-text-q2_K',
        size: '581 MB',
        context: '128k',
        input: 'Text',
        cloud: false,
        thinking: false
      },
    ],
  },
]

/**
 * Curated MLX-only highlight cards (oMLX mode only).
 *
 * The admin's remote catalog (api.projectnomad.us) is keyed by Ollama *family*
 * — one "qwen3" card — and in oMLX mode `resolveMlxPullName` family-matches a
 * card to the SMALLEST pullable key, so the MoE tag `qwen3:30b-a3b` never
 * surfaces as its own selectable card (the `qwen3` card resolves to
 * `qwen3:14b`). These synthetic catalog entries fix that: each is a full
 * NomadOllamaModel with `mlxPullName` PRE-SET to the exact model_map.json key,
 * a user-friendly `name` that won't collide with any remote-catalog family name
 * (so it renders as a separate card), and a curated description.
 *
 * They are PREPENDED to the catalog in OllamaService.getAvailableModels — but
 * ONLY in oMLX mode and ONLY for keys actually present in the proxy's pullable
 * set, so we never offer a card the proxy would refuse. `withMlxPullNames`
 * preserves the pre-set `mlxPullName` (skips family resolution) so each card
 * installs its exact key. Curate this list as new MLX-only picks land in
 * model_map.json.
 */
export const MLX_HIGHLIGHT_MODELS: NomadOllamaModel[] = [
  {
    name: 'Qwen3-30B-A3B (MoE)',
    description:
      'Qwen3 30B-A3B — a Mixture-of-Experts model: 30B total parameters, ~3B active per token. Big-model quality at small-model speed; great on 24GB+ Macs.',
    estimated_pulls: '5M',
    id: 'mlx-highlight-qwen3-30b-a3b',
    first_seen: '2026-06-04T00:00:00.000+00:00',
    model_last_updated: 'recently',
    mlxPullName: 'qwen3:30b-a3b',
    tags: [
      {
        name: 'qwen3:30b-a3b',
        size: '17 GB',
        context: '256K',
        input: 'Text',
        cloud: false,
        thinking: true,
      },
    ],
  },
  {
    name: 'Qwen3-Coder-30B-A3B (MoE)',
    description:
      'Qwen3-Coder 30B-A3B — a Mixture-of-Experts coding model: 30B total parameters, ~3B active per token. Strong code generation and agentic coding at ~3B-active speed; great on 24GB+ Macs.',
    estimated_pulls: '4M',
    id: 'mlx-highlight-qwen3-coder-30b-a3b',
    first_seen: '2026-06-04T00:00:00.000+00:00',
    model_last_updated: 'recently',
    mlxPullName: 'qwen3-coder:30b-a3b',
    tags: [
      {
        name: 'qwen3-coder:30b-a3b',
        size: '17 GB',
        context: '256K',
        input: 'Text',
        cloud: false,
        thinking: false,
      },
    ],
  },
  {
    name: 'DeepSeek-V2-Lite (MoE)',
    description:
      'DeepSeek-V2-Lite — a Mixture-of-Experts model: 16B total parameters, ~2.4B active per token. Fast, capable chat that fits 16GB Macs.',
    estimated_pulls: '3M',
    id: 'mlx-highlight-deepseek-v2-16b',
    first_seen: '2026-06-04T00:00:00.000+00:00',
    model_last_updated: 'recently',
    mlxPullName: 'deepseek-v2:16b',
    tags: [
      {
        name: 'deepseek-v2:16b',
        size: '9 GB',
        context: '32K',
        input: 'Text',
        cloud: false,
        thinking: false,
      },
    ],
  },
  {
    name: 'Hermes-4-14B (direct answers)',
    description:
      'Hermes 4 14B (Nous Research, Qwen3-14B base, Apache-2.0) — tuned for direct, low-refusal answers with strong system-prompt steerability. It prioritizes answering over hedging, which helps with blunt medical / survival / self-reliance questions that more cautious models deflect. Trade-off: it will answer confidently even when wrong, and offline there is no internet to cross-check — verify anything safety-critical.',
    estimated_pulls: '2M',
    id: 'mlx-highlight-hermes-4-14b',
    first_seen: '2026-06-06T00:00:00.000+00:00',
    model_last_updated: 'recently',
    mlxPullName: 'hermes-4:14b',
    tags: [
      {
        name: 'hermes-4:14b',
        size: '8 GB',
        context: '128K',
        input: 'Text',
        cloud: false,
        thinking: true,
      },
    ],
  },
]

/**
 * Adaptive RAG context limits based on model size.
 * Smaller models get overwhelmed with too much context, so we cap it.
 */
export const RAG_CONTEXT_LIMITS: { maxParams: number; maxResults: number; maxTokens: number }[] = [
  { maxParams: 3, maxResults: 2, maxTokens: 1000 },   // 1-3B models
  { maxParams: 8, maxResults: 4, maxTokens: 2500 },   // 4-8B models
  { maxParams: Infinity, maxResults: 5, maxTokens: 0 }, // 13B+ (no cap)
]

/** Minimum post-rerank score for a passage to enter a chat answer. */
export const RAG_MIN_FINAL_SCORE = 0.62
export const RELEVANCE_CHECK_MAX_TOKENS = 32
export const RAG_MIN_RELEVANCE_PRESETS = [
  { value: 0, label: 'Off — use every retrieved passage' },
  { value: 0.55, label: 'Lenient' },
  { value: RAG_MIN_FINAL_SCORE, label: 'Balanced (recommended)' },
  { value: 0.66, label: 'Strict' },
] as const

export const SYSTEM_PROMPTS = {
  relevance_check: `You check whether search results are about what a user asked.

Answer true if at least one passage is about the same specific subject as the question, even if it does not state the exact answer.

Answer false if the passages only share a word or a loose theme with the question. Also answer false if the user is not asking for information at all: greetings, chit-chat, or asking you to produce something new such as a poem, a joke, a translation, or a letter.

Respond with JSON: {"on_topic": true} or {"on_topic": false}`,
  default: `
 Format all responses using markdown for better readability. Vanilla markdown or GitHub-flavored markdown is preferred.
 - Use **bold** and *italic* for emphasis.
 - Use code blocks with language identifiers for code snippets.
 - Use headers (##, ###) to organize longer responses.
 - Use bullet points or numbered lists for clarity.
 - Use tables when presenting structured data.
`,
  rag_context: (context: string) => `
Information has been retrieved from the NOMAD knowledge base for the user's question. It
cleared a relevance filter before reaching you, so it is likely on topic — but automated
search may still miss the specific detail asked for.

[Knowledge Base Context]
${context}

HOW TO ANSWER:
1. When the context contains what was asked for, base your answer on it and answer directly.
2. When it does not, ignore it and answer from your own general knowledge. Do this silently —
   do not mention the knowledge base, the context, or the fact that it lacked an answer.
3. Never narrate your retrieval or reasoning process. Do not write "according to Context 1",
   "the context is unrelated, but", "I couldn't find specific context", or similar. Just
   give the answer as if you simply knew it.
4. Do not fabricate specifics (numbers, names, procedures) that are neither supported by
   the context nor part of your reliable knowledge.

Format your response using markdown for readability.
`,
  chat_suggestions: `
You are a helpful assistant that generates conversation starter suggestions for a survivalist/prepper using an AI assistant.

Provide exactly 3 conversation starter topics as direct questions that someone would ask.
These should be clear, complete questions that can start meaningful conversations.

Examples of good suggestions:
- "How do I purify water in an emergency?"
- "What are the best foods for long-term storage?"
- "Help me create a 72-hour emergency kit"

Do NOT use:
- Follow-up questions seeking clarification
- Vague or incomplete suggestions
- Questions that assume prior context
- Statements that are not suggestions themselves, such as praise for asking the question
- Direct questions or commands to the user

The suggestions should be in title case.
Respond with JSON: {"suggestions": ["...", "...", "..."]}
`,
  title_generation: `You are a title generator. Given the start of a conversation, generate a concise, descriptive title under 50 characters.

Respond with JSON: {"title": "..."}`,
  query_rewrite: `
You are a query rewriting assistant. Your task is to reformulate the user's latest question to include relevant context from the conversation history.

Given the conversation history, rewrite the user's latest question to be a standalone, context-aware search query that will retrieve the most relevant information.

Rules:
1. Keep the rewritten query concise (under 150 words)
2. Include key entities, topics, and context from previous messages
3. Make it a clear, searchable query
4. Do NOT answer the question - only rewrite the user's query to be more effective for retrieval
5. Respond with JSON: {"queries": ["..."]} — a single rewritten query in the array

Examples:

Conversation:
User: "How do I install Gentoo?"
Assistant: [detailed installation guide]
User: "Is an internet connection required to install?"

Rewritten Query: {"queries": ["Is an internet connection required to install Gentoo Linux?"]}

---

Conversation:
User: "What's the best way to preserve meat?"
Assistant: [preservation methods]
User: "How long does it last?"

Rewritten Query: {"queries": ["How long does preserved meat last using curing or smoking methods?"]}
`,
}
