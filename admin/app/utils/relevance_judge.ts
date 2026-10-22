/** The pure half of the optional off-topic check. */
export const JUDGE_EXCERPT_CHARS = 1500

export type JudgeablePassage = { text: string; title?: string }

export const ON_TOPIC_SCHEMA = {
  type: 'object',
  properties: { on_topic: { type: 'boolean' } },
  required: ['on_topic'],
  additionalProperties: false,
} as const

export function pickOnTopic(value: Record<string, unknown>): boolean | null {
  return typeof value.on_topic === 'boolean' ? value.on_topic : null
}

export function isRelevanceCheckEnabled(raw: unknown): boolean {
  return raw === true || raw === 'true'
}

/** Choose the passage window that contains the most long terms from the question. */
export function excerptFor(text: string, question: string, maxChars = JUDGE_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean

  const terms = [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 4)
    ),
  ]
  const lower = clean.toLowerCase()
  const hits: number[] = []
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
      hits.push(at)
    }
  }
  if (hits.length === 0) return clean.slice(0, maxChars) + '…'
  hits.sort((a, b) => a - b)

  let bestStart = hits[0]
  let bestCount = 0
  for (let lo = 0, hi = 0; hi < hits.length; hi++) {
    while (hits[hi] - hits[lo] > maxChars) lo++
    if (hi - lo + 1 > bestCount) {
      bestCount = hi - lo + 1
      bestStart = hits[lo]
    }
  }
  const start = Math.max(0, Math.min(bestStart - Math.floor(maxChars / 5), clean.length - maxChars))
  const end = start + maxChars
  return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '')
}

export function buildJudgeInput(question: string, passages: JudgeablePassage[]): string {
  const blocks = passages.map((passage, index) => {
    const heading = passage.title ? `p${index + 1} (from "${passage.title}")` : `p${index + 1}`
    return `${heading}:\n${excerptFor(passage.text, question)}`
  })
  return `Question: ${question.trim()}\n\n${blocks.join('\n\n')}`
}
