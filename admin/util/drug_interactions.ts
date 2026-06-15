/**
 * Parse the flattened FDA `drug_interactions` label text into ordered blocks for
 * readable rendering. The split is purely structural: every word of the original
 * text is preserved in order — only the numbered-section and bullet markers move
 * into block metadata. No FDA wording is altered, summarized, or dropped. The
 * content-fidelity invariant is enforced by the unit tests.
 */

/** One renderable block of parsed drug-interaction text. */
export interface InteractionBlock {
  /** Subsection label like "7.1", or null for intro/header text. */
  label: string | null
  /** Verbatim text (subsection label stripped from the front), or null for a bullet block. */
  text: string | null
  /** Verbatim bullet items, or null for a text block. */
  bullets: string[] | null
}

const HEADER_RE = /^\s*(\d{1,2})\s+DRUG\s+INTERACTIONS\b/i

export function parseInteractions(raw: string | null | undefined): InteractionBlock[] {
  if (!raw) return []
  const text = raw.trim()
  if (!text) return []

  // Anchor subsection detection to this label's interaction section number
  // (e.g. "7" from "7 DRUG INTERACTIONS") so inline cross-references such as
  // "(12.3)" or "( 7.1 )" are never mistaken for a subsection heading.
  const headerMatch = text.match(HEADER_RE)
  const major = headerMatch ? headerMatch[1] : null

  let pieces: string[]
  let labelRe: RegExp | null = null
  if (major) {
    // Split before "<major>.<n> <Capital><lowercase>". The \b prevents matching
    // inside a larger number (e.g. "17.1"); the [A-Z][a-z] requirement excludes
    // parenthetical refs like "( 7.1 )" (those are followed by ")"). Lookahead
    // only — no lookbehind — for broad browser support.
    const splitRe = new RegExp(`(?=\\b${major}\\.\\d{1,2}\\s+[A-Z][a-z])`)
    pieces = text.split(splitRe)
    labelRe = new RegExp(`^(${major}\\.\\d{1,2})\\s+`)
  } else {
    pieces = [text]
  }

  const blocks: InteractionBlock[] = []
  for (const rawPiece of pieces) {
    const piece = rawPiece.trim()
    if (!piece) continue

    let label: string | null = null
    let body = piece
    if (labelRe) {
      const m = piece.match(labelRe)
      if (m) {
        label = m[1]
        body = piece.slice(m[0].length).trim()
      }
    }

    if (body.includes('•')) {
      const parts = body.split('•')
      const lead = parts[0].trim()
      const items = parts.slice(1).map((s) => s.trim()).filter(Boolean)
      if (lead) {
        blocks.push({ label, text: lead, bullets: null })
        if (items.length) blocks.push({ label: null, text: null, bullets: items })
      } else if (items.length) {
        blocks.push({ label, text: null, bullets: items })
      }
    } else if (body) {
      blocks.push({ label, text: body, bullets: null })
    }
  }

  return blocks
}

/** True when a text block is just the "N DRUG INTERACTIONS" section header. */
export function isSectionHeader(text: string | null): boolean {
  return !!text && /^\s*\d{1,2}\s+DRUG\s+INTERACTIONS\s*$/i.test(text)
}
