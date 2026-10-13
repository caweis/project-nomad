/** JSON Schemas for the short ancillary chat calls. */
export const TITLE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
} as const

export const SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const

export const QUERIES_SCHEMA = {
  type: 'object',
  properties: { queries: { type: 'array', items: { type: 'string' }, minItems: 1 } },
  required: ['queries'],
  additionalProperties: false,
} as const

export type StructuredResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'constrained-parse-failed' | 'unconstrained' }

export function shouldConstrainStructuredOutput(
  backend: string | undefined,
  format: string | object | undefined
): boolean {
  // The oMLX proxy accepts only format: 'json' and does not forward it to its
  // OpenAI-compatible backend. A schema there would be rejected before chat.
  return backend !== 'omlx' && format !== undefined
}

/** Parse a JSON object, allowing fences or prose around an unconstrained reply. */
export function parseStructured<T>(
  raw: string,
  pick: (value: Record<string, unknown>) => T | null
): T | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return pick(value as Record<string, unknown>)
  } catch {
    return null
  }
}

export function resolveStructured<T>(
  raw: string,
  pick: (value: Record<string, unknown>) => T | null,
  constrained: boolean
): StructuredResult<T> {
  const value = parseStructured(raw, pick)
  if (value !== null) return { ok: true, value }
  return { ok: false, reason: constrained ? 'constrained-parse-failed' : 'unconstrained' }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const cleaned = value.map(cleanString).filter((item): item is string => item !== null)
  return cleaned.length > 0 ? cleaned : null
}

export function pickTitle(value: Record<string, unknown>): string | null {
  return cleanString(value.title)
}

export function pickSuggestions(value: Record<string, unknown>): string[] | null {
  return cleanStringArray(value.suggestions)?.slice(0, 3) ?? null
}

export function pickQueries(value: Record<string, unknown>): string[] | null {
  return cleanStringArray(value.queries)
}
